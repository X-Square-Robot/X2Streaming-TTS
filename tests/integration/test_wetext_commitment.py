from __future__ import annotations

import pytest

from x2streaming_tts import X2StreamingPolicy
from x2streaming_tts.commitment.text_normalizer import (
    TextNormalizationError,
    get_wetext_chinese_normalizer,
)

pytestmark = pytest.mark.integration


def _normalizer():
    try:
        return get_wetext_chinese_normalizer()
    except TextNormalizationError:
        pytest.skip("WeTextProcessing is not installed")


@pytest.mark.parametrize(
    ("source", "spoken"),
    [
        ("25℃", "二十五摄氏度"),
        ("12.5%", "百分之十二点五"),
        ("2026年8月6日", "二零二六年八月六日"),
    ],
)
def test_wetext_matches_reported_special_text_readings(
    source: str,
    spoken: str,
) -> None:
    assert _normalizer().normalize(source) == spoken


def test_real_normalizer_is_packet_seam_invariant() -> None:
    source = "温度是25℃，完成率12.5%。"

    def render(packets: list[str]) -> tuple[str, list[int]]:
        commitment = X2StreamingPolicy(
            text_normalizer=_normalizer()
        ).new_causal_commitment()
        spans = []
        for packet in packets:
            spans.extend(commitment.feed_text(packet))
        spans.extend(commitment.feed_text("", final=True))
        output = ""
        boundaries = []
        for span in spans:
            if span.boundary_before:
                boundaries.append(len(output))
            output += span.text
        return output, boundaries

    expected = render([source])
    for seam in range(1, len(source)):
        assert render([source[:seam], source[seam:]]) == expected
