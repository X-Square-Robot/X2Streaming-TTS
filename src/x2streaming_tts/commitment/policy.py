"""Unified causal-commitment mechanism from the X2Streaming-TTS paper."""

from __future__ import annotations

from typing import Iterable

from .capacity import (
    AdaptiveCapacityEstimator,
    CapacityConfig,
    CausalCommitmentController,
    CommitmentDecision,
)
from .rule_boundary import RuleBoundaryFrontend, RuleBoundarySpan
from .text_normalizer import TextNormalizer


class CausalCommitment:
    """Own uncertainty buffering and capacity-aware closure as one mechanism."""

    def __init__(
        self,
        *,
        capacity: CapacityConfig,
        rules: Iterable[str],
        text_normalizer: TextNormalizer,
        normalize_special_spans: bool = True,
        symbol_only_boundary_mode: str = "coalesce",
    ) -> None:
        self.boundaries = RuleBoundaryFrontend(
            enabled=True,
            rules=rules,
            emit_boundaries=True,
            text_normalizer=text_normalizer,
            normalize_special_spans=normalize_special_spans,
            symbol_only_boundary_mode=symbol_only_boundary_mode,
        )
        self.capacity = AdaptiveCapacityEstimator(capacity)
        self.controller = CausalCommitmentController(self.capacity)

    def feed_text(self, text: str, *, final: bool = False) -> list[RuleBoundarySpan]:
        return self.boundaries.feed(text, final=final)

    def feed_token(self, *, punct_level: int = 0) -> CommitmentDecision:
        return self.controller.feed(punct_level=punct_level)

    def splitter_config(self) -> dict[str, int | float]:
        """Return the paper configuration consumed by an engine splitter."""

        config = self.capacity.config
        return {
            "engine_max_decode_len": config.decode_budget,
            "prefill_len": config.prefill_len,
            "ema_ratio": self.capacity.ratio,
            "safety_margin": config.safety_margin,
            "ema_alpha": config.ema_alpha,
            "ema_overflow_alpha": config.ema_overflow_alpha,
            "ema_min_ratio": config.ema_min_ratio,
            "ema_max_ratio": config.ema_max_ratio,
            "l1_split_cap_ratio": config.l1_split_cap_ratio,
            "l2_split_cap_ratio": config.l2_split_cap_ratio,
            "l3_split_cap_ratio": config.l3_split_cap_ratio,
        }

    def split_thresholds(self):
        """Return the current delayed-feedback commitment thresholds."""

        return self.capacity.thresholds

    def observe_segment(
        self,
        *,
        audio_steps: int,
        text_tokens: int,
        overflow: bool = False,
    ) -> float:
        return self.capacity.observe(audio_steps, text_tokens, overflow=overflow)

    def finish(self) -> tuple[list[RuleBoundarySpan], CommitmentDecision | None]:
        return self.boundaries.finish(), self.controller.finish()

    def reset(self) -> None:
        self.boundaries.reset()
