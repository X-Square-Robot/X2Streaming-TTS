# Third-party components

## Qwen3TTS-Streaming

- Repository: https://github.com/X-Square-Robot/Qwen3TTS-Streaming
- Integration: pinned git submodule at `third_party/Qwen3TTS-Streaming`
- License: MIT
- Copyright: XSquareRobot

The exact tested commit is recorded in `UPSTREAM_LOCK.json`. Source code from
this dependency is not copied into `src/x2streaming_tts`.

## Qwen3-TTS

- Repository: https://github.com/QwenLM/Qwen3-TTS
- Integration: nested submodule of Qwen3TTS-Streaming
- License: Apache License 2.0
- Copyright: Alibaba Cloud / Qwen team

## Runtime components

Qwen3-TTS model weights, NVIDIA TensorRT, Triton Inference Server and optional
runtime dependencies are not distributed by this repository. Users must
review and accept the terms published by their respective providers.

The optional TEN VAD path in Qwen3TTS-Streaming has additional non-standard
license conditions and is not enabled or installed by X2Streaming-TTS.

