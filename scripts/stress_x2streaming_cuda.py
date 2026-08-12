#!/usr/bin/env python3
"""Long-running bounded-state stress test for the unified method."""

from __future__ import annotations

import json
import random
import time
from types import SimpleNamespace

import torch

from x2streaming_tts import SpeechStateInheritanceConfig, X2StreamingConfig
from x2streaming_tts.commitment import (
    AdaptiveCapacityEstimator,
    CausalCommitmentController,
)
from x2streaming_tts.inheritance.speech_state_inheritance import (
    CausalSpeechStateInheritance,
    build_text_acoustic_bridge,
)


def stress_device(device: torch.device, segments: int = 2000) -> dict:
    config = SpeechStateInheritanceConfig()
    inheritance = CausalSpeechStateInheritance(config)
    generator = torch.Generator(device=device).manual_seed(20260806)
    torch.cuda.set_device(device)
    torch.empty(1, device=device)
    torch.cuda.synchronize(device)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats(device)
    started = time.perf_counter()

    for segment_idx in range(segments):
        for position in range(4):
            inheritance.observe_hidden(
                segment_idx,
                position,
                torch.randn(1, 256, device=device, generator=generator),
            )
        state = SimpleNamespace(
            c2w_kv=torch.randn(2, 8, 128, 64, device=device, generator=generator),
            c2w_conv_states=[
                torch.randn(1, 64, 32, device=device, generator=generator)
            ],
            c2w_transconv_states=[
                torch.randn(1, 64, 32, device=device, generator=generator)
            ],
            frame_idx=segment_idx * 6,
        )
        if not inheritance.finalize_segment(
            segment_idx,
            [1, 2, 3, 4],
            eos_reason="codec_eos",
            audio_steps=24,
            state=state,
            consumed_text_tokens=4,
        ):
            raise RuntimeError(f"healthy segment {segment_idx} broke the chain")
        context = inheritance.context_for(segment_idx + 1)
        acoustic_tail = inheritance.acoustic_tail_for(segment_idx + 1, 4)
        if context is None or acoustic_tail is None:
            raise RuntimeError(f"segment {segment_idx} did not publish both paths")
        query = acoustic_tail[-1:].reshape(1, 1, -1)
        memory = torch.cat(
            [
                acoustic_tail,
                torch.randn(8, 256, device=device, generator=generator),
            ],
            dim=0,
        )
        bridge = build_text_acoustic_bridge(
            query=query,
            text_memory=memory,
            previous_center=None,
            settings=config,
            current_text_index=memory.shape[0] - 1,
        )
        if bridge is None or not torch.isfinite(bridge.context).all():
            raise RuntimeError(f"bridge failed at segment {segment_idx}")

    torch.cuda.synchronize(device)
    return {
        "device": str(device),
        "segments": segments,
        "elapsed_s": round(time.perf_counter() - started, 3),
        "allocated_bytes": torch.cuda.memory_allocated(device),
        "peak_allocated_bytes": torch.cuda.max_memory_allocated(device),
        "finalized_segment": inheritance.last_finalized,
    }


def stress_commitment(tokens: int = 100_000) -> dict:
    randomizer = random.Random(20260806)
    estimator = AdaptiveCapacityEstimator(X2StreamingConfig().capacity)
    controller = CausalCommitmentController(estimator)
    closures = 0
    started = time.perf_counter()
    for index in range(tokens):
        punct = randomizer.choices((0, 1, 2, 3), weights=(90, 3, 4, 3))[0]
        decision = controller.feed(punct_level=punct)
        if decision.close_after:
            closures += 1
            text_tokens = max(1, decision.token_count)
            audio_steps = min(10 * text_tokens, max(2 * text_tokens, 6 * text_tokens))
            estimator.observe(audio_steps, text_tokens)
        if decision.token_count > estimator.thresholds.force_split_at:
            raise RuntimeError(f"capacity violation at token {index}")
    controller.finish()
    return {
        "tokens": tokens,
        "closures": closures,
        "final_ratio": estimator.ratio,
        "elapsed_s": round(time.perf_counter() - started, 3),
    }


def main() -> int:
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable")
    result = {
        "commitment": stress_commitment(),
        "inheritance": [
            stress_device(torch.device(f"cuda:{index}"))
            for index in range(torch.cuda.device_count())
        ],
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
