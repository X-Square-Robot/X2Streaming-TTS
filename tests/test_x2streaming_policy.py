from __future__ import annotations

import pytest

from x2streaming_tts import X2StreamingConfig, X2StreamingPolicy
from x2streaming_tts.commitment import CausalCommitment
from x2streaming_tts.inheritance.speech_state_inheritance import (
    CausalSpeechStateInheritance,
)


class IdentityNormalizer:
    def normalize(self, text: str) -> str:
        return text


@pytest.mark.unit
def test_public_policy_exposes_exactly_two_paper_mechanisms() -> None:
    policy = X2StreamingPolicy(text_normalizer=IdentityNormalizer())

    assert isinstance(policy.new_causal_commitment(), CausalCommitment)
    assert isinstance(
        policy.new_speech_state_inheritance(), CausalSpeechStateInheritance
    )


@pytest.mark.unit
def test_public_defaults_match_reported_method() -> None:
    config = X2StreamingConfig()

    assert config.capacity.decode_budget == 384
    assert config.capacity.ema_ratio_initial == 6.0
    assert config.capacity.ema_alpha == 0.1
    assert config.capacity.ema_overflow_alpha == 0.5
    assert config.capacity.ema_min_ratio == 2.0
    assert config.capacity.ema_max_ratio == 10.0
    assert config.capacity.safety_margin == 8
    assert config.inheritance.text_acoustic_bridge_acoustic_tail == 4
    assert config.inheritance.text_acoustic_bridge_strength == 0.015
    assert config.inheritance.max_ctx_frames == 160
    assert config.inheritance.max_ctx_text_tokens == 192
    assert config.inheritance.max_ctx_segments == 2
    assert config.inheritance.stream_wait_ms == 1500


@pytest.mark.unit
def test_causal_commitment_unifies_buffering_and_capacity_feedback() -> None:
    commitment = X2StreamingPolicy(
        text_normalizer=IdentityNormalizer()
    ).new_causal_commitment()

    emitted = commitment.feed_text("温度是25")
    assert "".join(span.text for span in emitted) == "温度是"
    assert commitment.boundaries.pending_text == "25"
    for _ in range(3):
        decision = commitment.feed_token()
    assert decision.token_count == 3
    assert commitment.observe_segment(audio_steps=18, text_tokens=3) == pytest.approx(
        6.0
    )


@pytest.mark.unit
def test_commitment_exports_paper_splitter_configuration() -> None:
    commitment = X2StreamingPolicy(
        text_normalizer=IdentityNormalizer()
    ).new_causal_commitment()

    config = commitment.splitter_config()
    thresholds = commitment.split_thresholds()
    assert config["engine_max_decode_len"] == 384
    assert config["ema_ratio"] == 6.0
    assert thresholds.force_split_at == 60
