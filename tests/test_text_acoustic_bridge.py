from __future__ import annotations

import pytest
import torch

from x2streaming_tts import SpeechStateInheritanceConfig
from x2streaming_tts.inheritance.speech_state_inheritance import (
    build_text_acoustic_bridge,
)


@pytest.mark.unit
def test_paper_configuration_is_one_complete_method() -> None:
    settings = SpeechStateInheritanceConfig()

    assert settings.carry_c2w
    assert settings.use_text_acoustic_bridge
    assert settings.strict_token_streaming
    assert settings.text_acoustic_bridge_acoustic_tail == 4
    assert settings.text_acoustic_bridge_position_bias == (
        0.0,
        -0.125,
        -0.5,
        -1.125,
        -2.0,
        -2.302585093,
    )


@pytest.mark.unit
def test_disabled_continuity_disables_all_components() -> None:
    settings = SpeechStateInheritanceConfig(enabled=False)

    assert not settings.carry_c2w
    assert not settings.use_text_acoustic_bridge
    assert not settings.strict_token_streaming


@pytest.mark.unit
def test_text_acoustic_bridge_uses_reported_fp32_path() -> None:
    settings = SpeechStateInheritanceConfig()
    query = torch.randn(1, 1, 16, dtype=torch.float32)
    memory = torch.randn(6, 16, dtype=torch.float32)

    result = build_text_acoustic_bridge(
        query=query,
        text_memory=memory,
        previous_center=None,
        settings=settings,
        current_text_index=5,
    )

    assert result is not None
    assert result.context.dtype == torch.float32
    assert result.gate.dtype == torch.float32
    assert result.center.dtype == torch.float32
    assert result.confidence.dtype == torch.float32
    assert torch.isfinite(result.context).all()


@pytest.mark.unit
def test_future_text_positions_are_strictly_inaccessible() -> None:
    settings = SpeechStateInheritanceConfig()
    query = torch.tensor([[[1.0, 0.0, 0.0, 0.0]]])
    memory = torch.tensor(
        [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [1000.0, 1000.0, 1000.0, 1000.0],
        ]
    )

    baseline = build_text_acoustic_bridge(
        query=query,
        text_memory=memory,
        previous_center=None,
        settings=settings,
        current_text_index=1,
    )
    changed_future = memory.clone()
    changed_future[2] = torch.tensor([-9999.0, 5555.0, 7777.0, -3333.0])
    candidate = build_text_acoustic_bridge(
        query=query,
        text_memory=changed_future,
        previous_center=None,
        settings=settings,
        current_text_index=1,
    )

    assert baseline is not None and candidate is not None
    torch.testing.assert_close(candidate.context, baseline.context)
    torch.testing.assert_close(candidate.center, baseline.center)
