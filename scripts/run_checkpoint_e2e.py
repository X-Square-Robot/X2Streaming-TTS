#!/usr/bin/env python3
"""Run one isolated real-checkpoint request through the patched upstream engine."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import wave
from array import array
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream-root", type=Path, required=True)
    parser.add_argument("--engine-dir", type=Path, required=True)
    parser.add_argument("--weights-dir", type=Path, required=True)
    parser.add_argument("--tokenizer-dir", type=Path, required=True)
    parser.add_argument("--device", type=int, default=0)
    parser.add_argument("--speaker", default="vivian")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--warmup-rounds", type=int, default=1)
    parser.add_argument("--disable-x2", action="store_true")
    parser.add_argument("--output-wav", type=Path)
    parser.add_argument("--sample-rate", type=int, default=24000)
    parser.add_argument(
        "--packet",
        action="append",
        dest="packets",
        help="Streaming text packet; repeat for an asynchronous packet sequence.",
    )
    return parser.parse_args()


async def run(args: argparse.Namespace) -> dict[str, Any]:
    upstream = args.upstream_root.resolve()
    sys.path.insert(0, str(upstream / "client/src"))
    sys.path.insert(0, str(upstream))

    from engine.config import EngineConfig, load_model_manifest
    from engine.core.types import GroupPolicy, InputMode, SessionConfig
    from engine.server import TTSEngine

    extensions = None
    if not args.disable_x2:
        from x2streaming_tts import X2StreamingPolicy
        from x2streaming_tts.adapters.qwen3tts_streaming import (
            build_policy_factories,
        )
        from x2streaming_tts.commitment.text_normalizer import (
            get_wetext_chinese_normalizer,
        )

        policy = X2StreamingPolicy(
            text_normalizer=get_wetext_chinese_normalizer()
        )
        extensions = build_policy_factories(policy).to_upstream()

    cfg = EngineConfig()
    cfg.server.warmup_rounds = max(0, int(args.warmup_rounds))
    cfg.server.prewarm_speakers = []
    cfg.server.guarded_delivery_default = False
    cfg.scheduler.max_batch_size = 1
    cfg.scheduler.max_seq_len = 512
    cfg.spliter.max_concurrent_segments = 2
    cfg.paths.engine_dir = str(args.engine_dir.resolve())
    cfg.paths.weights_dir = str(args.weights_dir.resolve())
    cfg.paths.tokenizer_dir = str(args.tokenizer_dir.resolve())
    arch = load_model_manifest(
        cfg.paths.engine_dir,
        cfg,
        tokenizer_dir=cfg.paths.tokenizer_dir,
    )

    engine_kwargs: dict[str, Any] = {
        "config": cfg,
        "model_arch": arch,
        "engine_dir": cfg.paths.engine_dir,
        "weights_dir": cfg.paths.weights_dir,
        "tokenizer_dir": cfg.paths.tokenizer_dir,
        "device_id": args.device,
        "max_batch_size": 1,
        "max_sessions": 4,
        "max_seq_len": 512,
    }
    if extensions is not None:
        engine_kwargs["extensions"] = extensions
    engine = TTSEngine(**engine_kwargs)

    done = asyncio.Event()
    started_at = time.perf_counter()
    first_audio_at: float | None = None
    audio_bytes = 0
    audio_data = bytearray()
    events: list[dict[str, Any]] = []
    done_metrics: dict[str, Any] = {}

    async def on_audio(_session_id: str, data: bytes) -> None:
        nonlocal audio_bytes, first_audio_at
        if first_audio_at is None:
            first_audio_at = time.perf_counter()
        audio_bytes += len(data)
        if args.output_wav is not None:
            audio_data.extend(data)

    async def on_done(_session_id: str, metrics: dict[str, Any]) -> None:
        done_metrics.update(metrics)
        done.set()

    async def on_event(_session_id: str, event: dict[str, Any]) -> None:
        if event.get("type") in {
            "text_boundary_commit",
            "prefill_done",
            "segment_end",
            "warning",
        }:
            events.append(event)

    packets = args.packets or ["今天温度25", "℃。明天降至18", "℃，请注意保暖。"]
    session_id = f"x2-real-{int(time.time() * 1000)}"
    try:
        await engine.start()
        started_at = time.perf_counter()
        await engine.start_session(
            session_id,
            config=SessionConfig(
                task_type="custom_voice",
                language="chinese",
                speaker=args.speaker,
                input_mode=InputMode.TOKEN,
                group_policy=GroupPolicy.NONE,
            ),
            on_audio=on_audio,
            on_done=on_done,
            on_event=on_event,
        )
        for packet in packets:
            await engine.push_text_input(session_id, packet)
            await asyncio.sleep(0)
        await engine.mark_input_complete(session_id)
        await asyncio.wait_for(done.wait(), timeout=args.timeout)
    finally:
        await engine.stop()

    completed_at = time.perf_counter()
    if args.output_wav is not None:
        samples = array("f")
        samples.frombytes(audio_data)
        pcm = array(
            "h",
            (
                round(max(-1.0, min(1.0, float(sample))) * 32767.0)
                for sample in samples
            ),
        )
        output_wav = args.output_wav.resolve()
        output_wav.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(output_wav), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(args.sample_rate)
            wav_file.writeframes(pcm.tobytes())
    segment_ends = [event for event in events if event.get("type") == "segment_end"]
    carried = [
        event.get("meta", {}).get("extension_continuity_carried")
        for event in segment_ends
        if "extension_continuity_carried" in event.get("meta", {})
    ]
    return {
        "x2_enabled": not args.disable_x2,
        "device": args.device,
        "speaker": args.speaker,
        "packets": packets,
        "audio_bytes": audio_bytes,
        "output_wav": str(args.output_wav.resolve()) if args.output_wav else None,
        "ttft_ms": (
            round((first_audio_at - started_at) * 1000.0, 3)
            if first_audio_at is not None
            else None
        ),
        "elapsed_ms": round((completed_at - started_at) * 1000.0, 3),
        "segment_count": len(segment_ends),
        "continuity_carried": carried,
        "events": events,
        "done_metrics": done_metrics,
    }


def main() -> int:
    result = asyncio.run(run(parse_args()))
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    if result["done_metrics"].get("error"):
        return 1
    if int(result["audio_bytes"]) <= 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
