from __future__ import annotations

import pytest
import torch

from x2streaming_tts import SpeechStateInheritanceConfig
from x2streaming_tts.inheritance.speech_state_inheritance import (
    build_text_acoustic_bridge,
)

pytestmark = pytest.mark.gpu


def _devices() -> list[torch.device]:
    if not torch.cuda.is_available():
        pytest.skip("CUDA is unavailable")
    return [torch.device(f"cuda:{index}") for index in range(torch.cuda.device_count())]


@pytest.mark.parametrize("input_dtype", [torch.float16, torch.bfloat16, torch.float32])
def test_bridge_is_fp32_and_finite_on_every_gpu(input_dtype: torch.dtype) -> None:
    config = SpeechStateInheritanceConfig()
    for device in _devices():
        generator = torch.Generator(device=device).manual_seed(20260806)
        query = torch.randn(
            1, 1, 256, device=device, dtype=input_dtype, generator=generator
        )
        memory = torch.randn(
            17, 256, device=device, dtype=input_dtype, generator=generator
        )

        result = build_text_acoustic_bridge(
            query=query,
            text_memory=memory,
            previous_center=None,
            settings=config,
            current_text_index=12,
        )

        assert result is not None
        assert result.context.device == device
        assert result.context.dtype == torch.float32
        assert result.gate.dtype == torch.float32
        assert torch.isfinite(result.context).all()
        assert 0.0 <= result.gate.item() <= config.text_acoustic_bridge_strength


def test_future_mutation_is_bitwise_invisible_on_cuda() -> None:
    config = SpeechStateInheritanceConfig()
    for device in _devices():
        query = torch.tensor([[[1.0, 0.0, 0.0, 0.0]]], device=device)
        memory = torch.tensor(
            [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [1000.0, 1000.0, 1000.0, 1000.0],
            ],
            device=device,
        )
        baseline = build_text_acoustic_bridge(
            query=query,
            text_memory=memory,
            previous_center=None,
            settings=config,
            current_text_index=1,
        )
        memory[2] = torch.tensor([-9999.0, 5555.0, 7777.0, -3333.0], device=device)
        candidate = build_text_acoustic_bridge(
            query=query,
            text_memory=memory,
            previous_center=None,
            settings=config,
            current_text_index=1,
        )

        assert baseline is not None and candidate is not None
        assert torch.equal(candidate.context, baseline.context)
        assert torch.equal(candidate.center, baseline.center)
        assert torch.equal(candidate.gate, baseline.gate)


def test_cpu_cuda_parity() -> None:
    config = SpeechStateInheritanceConfig()
    torch.manual_seed(20260806)
    query = torch.randn(1, 1, 128)
    memory = torch.randn(11, 128)
    expected = build_text_acoustic_bridge(
        query=query,
        text_memory=memory,
        previous_center=None,
        settings=config,
        current_text_index=8,
    )
    assert expected is not None

    for device in _devices():
        actual = build_text_acoustic_bridge(
            query=query.to(device),
            text_memory=memory.to(device),
            previous_center=None,
            settings=config,
            current_text_index=8,
        )
        assert actual is not None
        torch.testing.assert_close(
            actual.context.cpu(), expected.context, rtol=1e-5, atol=1e-6
        )
        torch.testing.assert_close(
            actual.gate.cpu(), expected.gate, rtol=1e-5, atol=1e-6
        )


def test_repeated_bridge_calls_do_not_retain_cuda_memory() -> None:
    config = SpeechStateInheritanceConfig()
    for device in _devices():
        torch.cuda.empty_cache()
        query = torch.randn(1, 1, 256, device=device)
        memory = torch.randn(24, 256, device=device)
        for _ in range(20):
            result = build_text_acoustic_bridge(
                query=query,
                text_memory=memory,
                previous_center=None,
                settings=config,
                current_text_index=23,
            )
        del result
        torch.cuda.synchronize(device)
        baseline = torch.cuda.memory_allocated(device)

        for _ in range(1000):
            result = build_text_acoustic_bridge(
                query=query,
                text_memory=memory,
                previous_center=None,
                settings=config,
                current_text_index=23,
            )
        del result
        torch.cuda.synchronize(device)
        retained = torch.cuda.memory_allocated(device) - baseline
        assert retained <= 4096
