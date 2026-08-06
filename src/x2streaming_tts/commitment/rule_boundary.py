"""Streaming semantic-boundary frontend.

This stage runs after transport cleanup and before tokenization. It holds an
unresolved numeric or non-natural-language suffix across transport packets,
normalizes the complete span, and emits explicit semantic boundaries.

The emitted ``boundary_before`` marker is intentionally text-side only. The
Spliter turns it into a normal ``FLUSH_EOS`` for the preceding segment, so the
existing continuity health gate, tail carry and soft-prior paths all observe a
real finalized acoustic boundary rather than a synthetic state shortcut.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Iterable, Pattern

from .text_normalizer import TextNormalizer

_FULLWIDTH_NUMBER_TRANS = str.maketrans("０１２３４５６７８９．", "0123456789.")
_CN_DIGITS = "零一二三四五六七八九"
_ASCII_OR_FULLWIDTH_ALNUM = re.compile(r"[0-9０-９A-Za-zＡ-Ｚａ-ｚ]")
_CJK_TN_UNIT_CHARS = frozenset(
    "年月日号时点分秒周季摄氏度华元角圆美欧人民币"
    "公里千米厘米毫米微纳平方立方克公斤斤吨升伏安瓦赫兹兆吉"
    "成折倍万亿"
)
_SPECIAL_LEADING_SYMBOLS = frozenset("$¥￥€£₽+-−—±~≈<>≤≥=×÷*/\\|@#^&_%％°℃℉")
_SPECIAL_BODY_SYMBOLS = frozenset(
    "$¥￥€£₽+-−—±~≈<>≤≥=×÷*/\\|@#^&_%％°℃℉()[]{}（）【】_?'\""
)
_AMBIGUOUS_JOIN_PUNCT = frozenset(".,:．，：")
_TRAILING_CLAUSE_PUNCT = frozenset("，。！？；：．,.!?;:")


def _integer_to_chinese(value: int) -> str:
    """Verbalize a non-negative integer using ordinary Mandarin units."""
    if value == 0:
        return "零"
    if value > 9999:
        return "".join(_CN_DIGITS[int(ch)] for ch in str(value))
    units = ("", "十", "百", "千")
    digits = list(map(int, str(value)))
    parts: list[str] = []
    pending_zero = False
    for index, digit in enumerate(digits):
        unit_index = len(digits) - index - 1
        if digit == 0:
            pending_zero = bool(parts)
            continue
        if pending_zero:
            parts.append("零")
            pending_zero = False
        if not (digit == 1 and unit_index == 1 and not parts):
            parts.append(_CN_DIGITS[digit])
        parts.append(units[unit_index])
    return "".join(parts)


def verbalize_percentage(surface: str) -> str:
    """Convert a complete ASCII/full-width percentage span to spoken Chinese."""
    number = surface.translate(_FULLWIDTH_NUMBER_TRANS).strip()
    number = re.sub(r"[ \t]*[%％]\Z", "", number)
    whole, dot, fraction = number.partition(".")
    spoken = _integer_to_chinese(int(whole))
    if dot:
        spoken += "点" + "".join(_CN_DIGITS[int(ch)] for ch in fraction)
    return "百分之" + spoken


@dataclass(frozen=True)
class RuleBoundarySpan:
    """A safe-to-tokenize text span and its boundary instruction."""

    text: str
    boundary_before: bool = False
    rule_name: str = ""
    source_text: str = ""
    normalization_ms: float = 0.0


@dataclass(frozen=True)
class _CompiledRule:
    name: str
    pattern: Pattern[str]
    pending_suffix: Pattern[str]


_RULES = {
    "percentage": _CompiledRule(
        name="percentage",
        pattern=re.compile(r"[0-9０-９]+(?:[.．][0-9０-９]+)?[ \t]*[%％]"),
        pending_suffix=re.compile(r"[0-9０-９]+(?:[.．][0-9０-９]*)?[ \t]*$"),
    ),
}
_SUPPORTED_RULES = frozenset((*_RULES, "special_text"))
_SYMBOL_ONLY_BOUNDARY_MODES = frozenset(("isolate", "coalesce"))


def _is_cjk(ch: str) -> bool:
    if not ch:
        return False
    codepoint = ord(ch)
    return (
        0x3400 <= codepoint <= 0x4DBF
        or 0x4E00 <= codepoint <= 0x9FFF
        or 0xF900 <= codepoint <= 0xFAFF
    )


def _is_special_start(ch: str) -> bool:
    return bool(
        ch
        and (_ASCII_OR_FULLWIDTH_ALNUM.fullmatch(ch) or ch in _SPECIAL_LEADING_SYMBOLS)
    )


def _has_spoken_content(text: str) -> bool:
    """Return whether a special span is more than attachment punctuation."""
    return any(_ASCII_OR_FULLWIDTH_ALNUM.fullmatch(ch) or _is_cjk(ch) for ch in text)


def _next_nonspace(text: str, start: int) -> str:
    for index in range(start, len(text)):
        if not text[index].isspace():
            return text[index]
    return ""


def _continues_special_text(
    text: str,
    index: int,
    *,
    seen_digit: bool,
) -> bool:
    ch = text[index]
    if _ASCII_OR_FULLWIDTH_ALNUM.fullmatch(ch):
        return True
    if ch in _SPECIAL_BODY_SYMBOLS:
        return True
    if ch in _AMBIGUOUS_JOIN_PUNCT:
        previous = text[index - 1] if index > 0 else ""
        following = _next_nonspace(text, index + 1)
        if not following:
            # Decimal/version/time punctuation at a packet frontier remains
            # unresolved until another token or end-of-input arrives.
            return True
        return bool(
            previous and _is_special_start(previous) and _is_special_start(following)
        )
    if ch.isspace():
        following = _next_nonspace(text, index + 1)
        return bool(following and _is_special_start(following))
    return bool(seen_digit and _is_cjk(ch) and ch in _CJK_TN_UNIT_CHARS)


class RuleBoundaryFrontend:
    """Incrementally isolate and normalize semantic special-text clauses.

    ``special_text`` recognizes numeric, ambiguous and non-natural-language
    runs. ``percentage`` retains the narrower legacy behavior.
    """

    def __init__(
        self,
        *,
        enabled: bool = True,
        rules: Iterable[str] = ("percentage",),
        verbalize_percentage_spans: bool = False,
        emit_boundaries: bool = True,
        text_normalizer: TextNormalizer | None = None,
        normalize_special_spans: bool = True,
        symbol_only_boundary_mode: str = "coalesce",
    ) -> None:
        self._enabled = bool(enabled)
        if isinstance(rules, str):
            rules = (rules,)
        names = tuple(str(name).strip() for name in rules if str(name).strip())
        unknown = sorted(set(names).difference(_SUPPORTED_RULES))
        if unknown:
            raise ValueError("unknown rule-boundary rule(s): " + ", ".join(unknown))
        self._rule_names = names
        self._rules = tuple(_RULES[name] for name in names if name in _RULES)
        self._special_text_enabled = "special_text" in names
        self._verbalize_percentage_spans = bool(verbalize_percentage_spans)
        self._emit_boundaries = bool(emit_boundaries)
        self._text_normalizer = text_normalizer
        self._normalize_special_spans = bool(normalize_special_spans)
        boundary_mode = str(symbol_only_boundary_mode).strip().lower()
        if boundary_mode not in _SYMBOL_ONLY_BOUNDARY_MODES:
            raise ValueError(
                "symbol_only_boundary_mode must be one of: "
                + ", ".join(sorted(_SYMBOL_ONLY_BOUNDARY_MODES))
            )
        self._symbol_only_boundary_mode = boundary_mode
        if (
            self._enabled
            and self._special_text_enabled
            and self._normalize_special_spans
            and self._text_normalizer is None
        ):
            raise ValueError(
                "special_text normalization is enabled but no text normalizer "
                "was provided"
            )
        self._pending = ""
        self._resume_boundary_pending = False

    @property
    def pending_text(self) -> str:
        return self._pending

    def feed(self, text: str, *, final: bool = False) -> list[RuleBoundarySpan]:
        """Consume transport-cleaned text and return tokenization-safe spans."""

        combined = self._pending + (text or "")
        self._pending = ""
        if not combined:
            return []
        if not self._enabled or not self._rule_names:
            self._resume_boundary_pending = False
            return [RuleBoundarySpan(combined)]

        if self._special_text_enabled:
            return self._split_special_text(combined, final=final)

        safe = combined
        if not final:
            hold_from = self._pending_suffix_start(combined)
            if hold_from is not None:
                safe = combined[:hold_from]
                self._pending = combined[hold_from:]

        return self._split_safe_text(safe)

    def finish(self) -> list[RuleBoundarySpan]:
        """Release and normalize the final unresolved suffix."""

        return self.feed("", final=True)

    def reset(self) -> None:
        self._pending = ""
        self._resume_boundary_pending = False

    def _pending_suffix_start(self, text: str) -> int | None:
        starts = []
        for rule in self._rules:
            match = rule.pending_suffix.search(text)
            if match is not None:
                starts.append(match.start())
        return min(starts) if starts else None

    def _split_safe_text(self, text: str) -> list[RuleBoundarySpan]:
        if not text:
            return []

        matches: list[tuple[int, int, int, str]] = []
        for priority, rule in enumerate(self._rules):
            matches.extend(
                (match.start(), match.end(), priority, rule.name)
                for match in rule.pattern.finditer(text)
            )
        matches.sort(key=lambda item: (item[0], item[2], -(item[1] - item[0])))

        spans: list[RuleBoundarySpan] = []
        cursor = 0
        for start, end, _priority, name in matches:
            if start < cursor:
                continue
            if start > cursor:
                spans.append(RuleBoundarySpan(text[cursor:start]))
            matched_text = text[start:end]
            if name == "percentage" and self._verbalize_percentage_spans:
                matched_text = verbalize_percentage(matched_text)
            spans.append(
                RuleBoundarySpan(
                    matched_text,
                    boundary_before=self._emit_boundaries,
                    rule_name=name,
                )
            )
            cursor = end
        if cursor < len(text):
            spans.append(RuleBoundarySpan(text[cursor:]))
        return spans or [RuleBoundarySpan(text)]

    def _split_special_text(
        self,
        text: str,
        *,
        final: bool,
    ) -> list[RuleBoundarySpan]:
        if not text:
            return []

        spans: list[RuleBoundarySpan] = []
        cursor = 0
        natural_boundary = self._resume_boundary_pending
        self._resume_boundary_pending = False

        while cursor < len(text):
            start = cursor
            while start < len(text) and not _is_special_start(text[start]):
                start += 1

            if start > cursor:
                natural_text = text[cursor:start]
                spans.append(
                    RuleBoundarySpan(
                        natural_text,
                        boundary_before=(self._emit_boundaries and natural_boundary),
                        rule_name="natural_resume" if natural_boundary else "",
                    )
                )
                natural_boundary = False

            if start >= len(text):
                break

            end = start
            seen_digit = False
            while end < len(text):
                ch = text[end]
                if end > start and not _continues_special_text(
                    text,
                    end,
                    seen_digit=seen_digit,
                ):
                    break
                seen_digit = seen_digit or ch.isdigit()
                end += 1

            punct_end = end
            while punct_end < len(text) and text[punct_end] in _TRAILING_CLAUSE_PUNCT:
                punct_end += 1

            if end == len(text) and not final:
                self._pending = text[start:]
                break

            source_core = text[start:end]
            suffix = text[end:punct_end]
            creates_semantic_boundary = (
                self._symbol_only_boundary_mode == "isolate"
                or _has_spoken_content(source_core)
            )
            started = time.perf_counter()
            normalized = self._normalize_special(source_core)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            spans.append(
                RuleBoundarySpan(
                    normalized + suffix,
                    boundary_before=(
                        self._emit_boundaries and creates_semantic_boundary
                    ),
                    rule_name="special_text",
                    source_text=source_core,
                    normalization_ms=elapsed_ms,
                )
            )
            cursor = punct_end
            # A pure symbol attaches to the natural clause on its left: it
            # does not open a standalone acoustic segment, but the following
            # natural text still starts at a semantic boundary.
            natural_boundary = True
            if cursor >= len(text) and suffix and not final:
                self._resume_boundary_pending = True

        return spans

    def _normalize_special(self, text: str) -> str:
        if not self._normalize_special_spans:
            return text
        if self._text_normalizer is None:
            raise RuntimeError("special-text normalizer is unavailable")
        normalized = str(self._text_normalizer.normalize(text) or "")
        if not normalized:
            raise ValueError(f"text normalizer returned empty text for {text!r}")
        return normalized


__all__ = ("RuleBoundaryFrontend", "RuleBoundarySpan", "verbalize_percentage")
