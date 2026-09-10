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

## WeTextProcessing

- Repository: https://github.com/wenet-e2e/WeTextProcessing
- Integration: optional `tn` dependency, pinned to version 1.2.0
- License: [Apache License 2.0](https://github.com/wenet-e2e/WeTextProcessing/blob/master/LICENSE)

The Chinese text-normalization adapter calls the installed package. Its source and
language resources are not copied into this repository.

## Separately released model weights

The method code in this repository is MIT-licensed. The following weights are
distributed separately under Apache-2.0, with a full `LICENSE` and a `NOTICE` in each
model repository:

- [X2Streaming-TTS-1.7B](https://huggingface.co/x-square-robot/X2Streaming-TTS-1.7B):
  X Square Robot's fine-tuned `robot_service_v1` CustomVoice checkpoint, derived from
  [Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base).
  It includes the unchanged
  [Qwen3-TTS-Tokenizer-12Hz](https://huggingface.co/Qwen/Qwen3-TTS-Tokenizer-12Hz).
  Both upstream components are released by the Qwen team under Apache-2.0.
- [X2-NativeCursor-Qwen3TTS-12Hz](https://huggingface.co/x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz):
  X Square Robot's progress-observer head. Its repository does not include the TTS
  backbone or speech tokenizer. [Qwen3-ForcedAligner](https://github.com/QwenLM/Qwen3-ASR)
  was used for training supervision; its weights are not included either.

The MIT license for this repository does not replace the licenses for those weights.

## Runtime components

Qwen3-TTS model weights, NVIDIA TensorRT, Triton Inference Server and optional
runtime dependencies are not distributed by this repository. Users must
review and accept the terms published by their respective providers.

The optional TEN VAD path in Qwen3TTS-Streaming has additional non-standard
license conditions and is not enabled or installed by X2Streaming-TTS.
