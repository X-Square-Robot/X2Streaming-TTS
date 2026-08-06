#!/usr/bin/env python3
"""Measure the paper bridge in isolation on every visible CUDA device."""

from __future__ import annotations

import json
import statistics
import time

import torch

from x2streaming_tts import SpeechStateInheritanceConfig
from x2streaming_tts.inheritance.speech_state_inheritance import (
    build_text_acoustic_bridge,
)


def benchmark(
    device: torch.device, iterations: int = 1000
) -> dict[str, float | int | str]:
    config = SpeechStateInheritanceConfig()
    generator = torch.Generator(device=device).manual_seed(20260806)
    query = torch.randn(1, 1, 256, device=device, generator=generator)
    memory = torch.randn(24, 256, device=device, generator=generator)

    for _ in range(100):
        build_text_acoustic_bridge(
            query=query,
            text_memory=memory,
            previous_center=None,
            settings=config,
            current_text_index=23,
        )
    torch.cuda.synchronize(device)
    torch.cuda.reset_peak_memory_stats(device)

    samples_us = []
    for _ in range(iterations):
        start = time.perf_counter_ns()
        build_text_acoustic_bridge(
            query=query,
            text_memory=memory,
            previous_center=None,
            settings=config,
            current_text_index=23,
        )
        torch.cuda.synchronize(device)
        samples_us.append((time.perf_counter_ns() - start) / 1000.0)

    return {
        "device": str(device),
        "name": torch.cuda.get_device_name(device),
        "iterations": iterations,
        "median_us": round(statistics.median(samples_us), 3),
        "p95_us": round(statistics.quantiles(samples_us, n=20)[18], 3),
        "peak_allocated_bytes": torch.cuda.max_memory_allocated(device),
    }


def main() -> int:
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable")
    results = [
        benchmark(torch.device(f"cuda:{index}"))
        for index in range(torch.cuda.device_count())
    ]
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
