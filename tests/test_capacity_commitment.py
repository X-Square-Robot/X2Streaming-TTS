from __future__ import annotations

import math

import pytest

from x2streaming_tts.commitment.capacity import (
    AdaptiveCapacityEstimator,
    CapacityConfig,
    CausalCommitmentController,
    compute_thresholds,
)


@pytest.mark.unit
@pytest.mark.parametrize("decode_budget", [64, 168, 384, 1024])
@pytest.mark.parametrize("ema_ratio", [2.0, 4.0, 6.0, 8.0, 10.0])
def test_thresholds_preserve_estimated_audio_budget(
    decode_budget: int,
    ema_ratio: float,
) -> None:
    prefill_len = 12
    safety_margin = 8
    thresholds = compute_thresholds(
        decode_budget - prefill_len,
        ema_ratio,
        safety_margin=safety_margin,
    )

    usable_audio_steps = decode_budget - prefill_len - safety_margin
    estimated_steps_at_cap = thresholds.force_split_at * max(1.0, ema_ratio)
    assert estimated_steps_at_cap <= usable_audio_steps
    assert (
        1
        <= thresholds.min_tokens_l1
        <= thresholds.min_tokens_l2
        <= thresholds.min_tokens_l3
        <= thresholds.force_split_at
    )


@pytest.mark.unit
def test_impossible_streaming_budget_is_rejected() -> None:
    with pytest.raises(ValueError, match="too small"):
        compute_thresholds(remaining_kv=20, ema_ratio=10.0, safety_margin=8)


@pytest.mark.unit
def test_hard_cap_includes_triggering_token() -> None:
    estimator = AdaptiveCapacityEstimator(
        CapacityConfig(
            decode_budget=26,
            prefill_len=12,
            safety_margin=8,
            ema_ratio_initial=1.0,
            ema_min_ratio=1.0,
            ema_max_ratio=1.0,
        )
    )
    controller = CausalCommitmentController(estimator)

    decisions = [controller.feed() for _ in range(6)]

    assert decisions[-1].close_after
    assert decisions[-1].token_count == 6
    assert decisions[-1].reason == "hard_cap"


@pytest.mark.unit
def test_punctuation_threshold_counts_current_token() -> None:
    estimator = AdaptiveCapacityEstimator(
        CapacityConfig(
            decode_budget=30,
            prefill_len=12,
            safety_margin=8,
            ema_ratio_initial=1.0,
            ema_min_ratio=1.0,
            ema_max_ratio=1.0,
            l1_split_cap_ratio=0.4,
            l2_split_cap_ratio=0.6,
            l3_split_cap_ratio=0.8,
        )
    )
    controller = CausalCommitmentController(estimator)

    for _ in range(3):
        assert not controller.feed().close_after
    decision = controller.feed(punct_level=1)

    assert decision.close_after
    assert decision.token_count == 4
    assert decision.reason == "l1"


@pytest.mark.unit
def test_overflow_feedback_adapts_faster_and_is_clipped() -> None:
    config = CapacityConfig(
        ema_ratio_initial=5.0,
        ema_alpha=0.1,
        ema_overflow_alpha=0.5,
        ema_min_ratio=2.0,
        ema_max_ratio=10.0,
    )
    normal = AdaptiveCapacityEstimator(config)
    overflow = AdaptiveCapacityEstimator(config)

    normal.observe(100, 10)
    overflow.observe(100, 10, overflow=True)

    assert normal.ratio == pytest.approx(5.5)
    assert overflow.ratio == pytest.approx(7.5)
    assert overflow.observe(10_000, 1, overflow=True) == 10.0


@pytest.mark.unit
def test_capacity_config_rejects_invalid_values() -> None:
    with pytest.raises(ValueError, match="finite and positive"):
        CapacityConfig(ema_ratio_initial=math.inf).validate()
    with pytest.raises(ValueError, match="0 < l1 <= l2 <= l3 <= 1"):
        CapacityConfig(l1_split_cap_ratio=0.8, l2_split_cap_ratio=0.7).validate()


@pytest.mark.unit
def test_decision_is_independent_of_unseen_future_tokens() -> None:
    config = CapacityConfig()
    left = CausalCommitmentController(AdaptiveCapacityEstimator(config))
    right = CausalCommitmentController(AdaptiveCapacityEstimator(config))

    observed = [0, 0, 2, 0]
    left_decisions = [left.feed(punct_level=value) for value in observed]
    right_decisions = [right.feed(punct_level=value) for value in observed]

    assert left_decisions == right_decisions
