from __future__ import annotations

import pytest

from x2streaming_tts.commitment.rule_boundary import RuleBoundaryFrontend


class _IdentityNormalizer:
    def normalize(self, text: str) -> str:
        return text


def _frontend(mode: str = "coalesce") -> RuleBoundaryFrontend:
    return RuleBoundaryFrontend(
        enabled=True,
        rules=("special_text",),
        text_normalizer=_IdentityNormalizer(),
        symbol_only_boundary_mode=mode,
    )


def _render_packets(packets: list[str]) -> tuple[str, list[int], list[str]]:
    frontend = _frontend()
    spans = []
    for packet in packets:
        spans.extend(frontend.feed(packet))
    spans.extend(frontend.finish())
    text = ""
    boundaries = []
    sources = []
    for span in spans:
        if span.boundary_before:
            boundaries.append(len(text))
        text += span.text
        if span.source_text:
            sources.append(span.source_text)
    return text, boundaries, sources


@pytest.mark.unit
@pytest.mark.parametrize("symbol", ["——", "—"])
def test_symbol_only_span_coalesces_with_neighboring_natural_text(symbol: str) -> None:
    spans = _frontend().feed(f"前文{symbol}后文", final=True)

    assert "".join(span.text for span in spans) == f"前文{symbol}后文"
    assert [span.boundary_before for span in spans] == [False, False, True]
    assert [span.source_text for span in spans if span.source_text] == [symbol]


@pytest.mark.unit
def test_symbol_only_coalescing_matches_whole_text_at_every_packet_seam() -> None:
    text = "前文——后文"
    baseline = _render_packets([text])

    for seam in range(1, len(text)):
        assert _render_packets([text[:seam], text[seam:]]) == baseline


@pytest.mark.unit
def test_isolate_mode_preserves_historical_symbol_boundaries() -> None:
    spans = _frontend("isolate").feed("前文——后文", final=True)

    assert [span.boundary_before for span in spans] == [False, True, True]
    assert [span.rule_name for span in spans] == [
        "",
        "special_text",
        "natural_resume",
    ]


@pytest.mark.unit
def test_spoken_special_span_creates_semantic_boundaries() -> None:
    spans = _frontend().feed("温度是25℃，请记录", final=True)

    special_index = next(index for index, span in enumerate(spans) if span.source_text)
    assert spans[special_index].source_text == "25℃"
    assert spans[special_index].boundary_before
    assert spans[special_index + 1].boundary_before


@pytest.mark.unit
def test_committed_prefix_is_invariant_to_future_packet_content() -> None:
    left = _frontend().feed("订单金额为12")
    right = _frontend().feed("订单金额为12")

    assert left == right
    assert "".join(span.text for span in left) == "订单金额为"
