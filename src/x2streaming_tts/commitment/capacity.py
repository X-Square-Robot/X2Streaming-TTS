"""Capacity-adaptive causal commitment independent of the upstream splitter."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class SplitThresholds:
    """Token thresholds for the three punctuation tiers and the hard cap."""

    min_tokens_l1: int
    min_tokens_l2: int
    min_tokens_l3: int
    force_split_at: int


def compute_thresholds(
    remaining_kv: int,
    ema_ratio: float,
    safety_margin: int = 8,
    l1_cap_ratio: float = 0.70,
    l2_cap_ratio: float = 0.80,
    l3_cap_ratio: float = 0.90,
) -> SplitThresholds:
    """Map an acoustic-step budget to strictly bounded text-token thresholds."""

    if (
        not isinstance(remaining_kv, int)
        or isinstance(remaining_kv, bool)
        or remaining_kv <= 0
    ):
        raise ValueError("remaining_kv must be a positive integer")
    if (
        not isinstance(safety_margin, int)
        or isinstance(safety_margin, bool)
        or safety_margin < 0
    ):
        raise ValueError("safety_margin must be a non-negative integer")
    if not math.isfinite(ema_ratio) or ema_ratio <= 0:
        raise ValueError("ema_ratio must be finite and positive")
    ratios = (l1_cap_ratio, l2_cap_ratio, l3_cap_ratio)
    if any(not math.isfinite(value) for value in ratios) or not (
        0.0 < l1_cap_ratio <= l2_cap_ratio <= l3_cap_ratio <= 1.0
    ):
        raise ValueError("split cap ratios must satisfy 0 < l1 <= l2 <= l3 <= 1")

    usable_steps = remaining_kv - safety_margin
    cap = int(usable_steps / max(1.0, float(ema_ratio)))
    if cap < 2:
        raise ValueError(
            "decoding budget is too small for budget-safe streaming: "
            f"remaining_kv={remaining_kv}, safety_margin={safety_margin}, "
            f"ema_ratio={ema_ratio}"
        )

    def tier(ratio: float) -> int:
        return max(1, min(cap, int(cap * ratio)))

    t1 = tier(l1_cap_ratio)
    t2 = max(t1, tier(l2_cap_ratio))
    t3 = max(t2, tier(l3_cap_ratio))
    return SplitThresholds(t1, t2, t3, cap)


@dataclass(frozen=True)
class CapacityConfig:
    """Capacity hyperparameters plus a standalone fallback cache budget.

    ``decode_budget`` and ``prefill_len`` describe the usable cache only when no
    engine has reported its own limit. Once an engine reports a budget through
    ``AdaptiveCapacityEstimator.bind_engine_budget``, that value takes
    precedence over the configured fallback.
    """

    decode_budget: int = 384
    prefill_len: int = 12
    safety_margin: int = 8
    ema_ratio_initial: float = 6.0
    ema_alpha: float = 0.1
    ema_overflow_alpha: float = 0.5
    ema_min_ratio: float = 2.0
    ema_max_ratio: float = 10.0
    l1_split_cap_ratio: float = 0.70
    l2_split_cap_ratio: float = 0.80
    l3_split_cap_ratio: float = 0.90

    def validate(self) -> None:
        if self.decode_budget <= 0 or self.prefill_len < 0:
            raise ValueError(
                "decode_budget must be positive and prefill_len non-negative"
            )
        if self.prefill_len >= self.decode_budget:
            raise ValueError("prefill_len must be smaller than decode_budget")
        for name in (
            "ema_ratio_initial",
            "ema_min_ratio",
            "ema_max_ratio",
        ):
            value = float(getattr(self, name))
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        if not self.ema_min_ratio <= self.ema_ratio_initial <= self.ema_max_ratio:
            raise ValueError("initial EMA ratio must lie inside its min/max interval")
        for name in ("ema_alpha", "ema_overflow_alpha"):
            value = float(getattr(self, name))
            if not math.isfinite(value) or not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be finite and in [0, 1]")
        compute_thresholds(
            self.decode_budget - self.prefill_len,
            self.ema_max_ratio,
            safety_margin=self.safety_margin,
            l1_cap_ratio=self.l1_split_cap_ratio,
            l2_cap_ratio=self.l2_split_cap_ratio,
            l3_cap_ratio=self.l3_split_cap_ratio,
        )


class AdaptiveCapacityEstimator:
    """Delayed-feedback estimator for acoustic steps per committed text token."""

    def __init__(self, config: CapacityConfig = CapacityConfig()) -> None:
        config.validate()
        self.config = config
        self._ratio = float(config.ema_ratio_initial)
        self._engine_remaining_kv: int | None = None

    @property
    def ratio(self) -> float:
        return self._ratio

    @property
    def engine_remaining_kv(self) -> int | None:
        """Post-prefill cache budget reported by the loaded engine, if any."""

        return self._engine_remaining_kv

    @property
    def remaining_kv(self) -> int:
        """Usable post-prefill budget: engine-reported when bound."""

        if self._engine_remaining_kv is not None:
            return self._engine_remaining_kv
        return self.config.decode_budget - self.config.prefill_len

    def bind_engine_budget(self, remaining_kv: int) -> None:
        """Adopt the post-prefill cache budget reported by the loaded engine."""

        if (
            not isinstance(remaining_kv, int)
            or isinstance(remaining_kv, bool)
            or remaining_kv <= 0
        ):
            raise ValueError("remaining_kv must be a positive integer")
        compute_thresholds(
            remaining_kv,
            self.config.ema_max_ratio,
            safety_margin=self.config.safety_margin,
            l1_cap_ratio=self.config.l1_split_cap_ratio,
            l2_cap_ratio=self.config.l2_split_cap_ratio,
            l3_cap_ratio=self.config.l3_split_cap_ratio,
        )
        self._engine_remaining_kv = remaining_kv

    @property
    def thresholds(self) -> SplitThresholds:
        return compute_thresholds(
            self.remaining_kv,
            self._ratio,
            safety_margin=self.config.safety_margin,
            l1_cap_ratio=self.config.l1_split_cap_ratio,
            l2_cap_ratio=self.config.l2_split_cap_ratio,
            l3_cap_ratio=self.config.l3_split_cap_ratio,
        )

    def observe(
        self,
        actual_audio_steps: int,
        actual_text_tokens: int,
        *,
        overflow: bool = False,
    ) -> float:
        if actual_text_tokens <= 0:
            return self._ratio
        observed = float(actual_audio_steps) / actual_text_tokens
        alpha = self.config.ema_overflow_alpha if overflow else self.config.ema_alpha
        updated = (1.0 - alpha) * self._ratio + alpha * observed
        self._ratio = max(
            self.config.ema_min_ratio,
            min(self.config.ema_max_ratio, updated),
        )
        return self._ratio


@dataclass(frozen=True)
class CommitmentDecision:
    action: str
    token_count: int
    close_after: bool = False
    reason: str = ""


class CausalCommitmentController:
    """Small upstream-independent form of the online stopping rule.

    ``punct_level`` uses 0 for ordinary text and 1–3 for strongest-to-weakest
    boundaries. Decisions depend only on the current token and prior state.
    """

    def __init__(self, estimator: AdaptiveCapacityEstimator) -> None:
        self.estimator = estimator
        self._token_count = 0

    @property
    def token_count(self) -> int:
        return self._token_count

    def feed(self, *, punct_level: int = 0) -> CommitmentDecision:
        if punct_level not in {0, 1, 2, 3}:
            raise ValueError("punct_level must be one of 0, 1, 2, 3")
        thresholds = self.estimator.thresholds
        self._token_count += 1
        action = "prefill" if self._token_count == 1 else "decode"

        close = False
        reason = ""
        if self._token_count > 1:
            if self._token_count >= thresholds.force_split_at:
                close, reason = True, "hard_cap"
            elif punct_level == 1 and self._token_count >= thresholds.min_tokens_l1:
                close, reason = True, "l1"
            elif punct_level == 2 and self._token_count >= thresholds.min_tokens_l2:
                close, reason = True, "l2"
            elif punct_level == 3 and self._token_count >= thresholds.min_tokens_l3:
                close, reason = True, "l3"

        decision = CommitmentDecision(action, self._token_count, close, reason)
        if close:
            self._token_count = 0
        return decision

    def finish(self) -> CommitmentDecision | None:
        if self._token_count == 0:
            return None
        decision = CommitmentDecision(
            "flush", self._token_count, close_after=True, reason="input_end"
        )
        self._token_count = 0
        return decision
