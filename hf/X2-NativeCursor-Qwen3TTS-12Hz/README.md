---
license: apache-2.0
language:
  - zh
  - en
tags:
  - text-to-speech
  - streaming
  - alignment
  - progress-tracking
  - qwen3-tts
  - x2-nativecursor
  - arxiv:2609.09677
---

<div align="center">
  <img src="assets/x-square-logo.png" width="140" alt="X Square Robot beaver mascot holding the moon">
  <h1>X2-NativeCursor-Qwen3TTS-12Hz</h1>
  <p><strong>Reading-progress observer for token-level streaming Qwen3-TTS</strong></p>
  <p>
    <a href="https://github.com/X-Square-Robot/X2Streaming-TTS"><img src="https://img.shields.io/badge/GitHub-X2Streaming--TTS-black" alt="X2Streaming-TTS"></a>
    <a href="https://github.com/X-Square-Robot/Qwen3TTS-Streaming"><img src="https://img.shields.io/badge/Engine-Qwen3TTS--Streaming-6f42c1" alt="Qwen3TTS-Streaming"></a>
    <a href="https://huggingface.co/x-square-robot/X2Streaming-TTS-1.7B"><img src="https://img.shields.io/badge/Hugging%20Face-X2Streaming--TTS--1.7B-yellow" alt="X2Streaming-TTS-1.7B"></a>
    <a href="https://arxiv.org/abs/2609.09677"><img src="https://img.shields.io/badge/arXiv-2609.09677-b31b1b" alt="X2-NativeCursor paper"></a>
  </p>
</div>

<div align="center">
  <img src="assets/native_cursor_use_cases.png" width="1000" alt="X2Streaming-TTS and X2-NativeCursor: streaming speech, continuous narration, synchronized highlighting, playback-aware interruption, and dialogue-history updates">
  <p><em>Speak as text arrives, track reading progress, and use the playback clock to keep interruptions and dialogue history aligned with played audio.</em></p>
</div>

Token-level streaming TTS starts speaking before the sentence is finished, so a client
receives audio without knowing which characters of the source text it carries.
X2-NativeCursor answers that question before waveform decoding: a 2M-parameter observer
reads the codebook-0 token the Qwen3-TTS Talker emits every 80 ms, scores it against the
spoken labels of the text visible so far, and publishes a cursor into the source text
that never moves backward. The TTS generator, the speech tokenizer and the vocoder stay
as they are; the observer is the only addition.

This repository holds the released observer head. It is integrated in the
[Qwen3TTS-Streaming](https://github.com/X-Square-Robot/Qwen3TTS-Streaming) engine
as a fused TensorRT observer in the runtime pinned by the Demo quick start, and
is described in the [X2-NativeCursor paper](https://arxiv.org/abs/2609.09677)
and on the [X2Streaming-TTS feature page](https://github.com/X-Square-Robot/X2Streaming-TTS/blob/main/docs/native_cursor.md).

## Live Demo and one-command setup

Watch the [Demo](https://x-square-robot.github.io/X2Streaming-TTS/) for streaming input,
continuous playback, and playback-synchronized highlighting. To try your own text,
run on a Linux NVIDIA GPU machine with Python 3.12+, Docker Compose and NVIDIA
Container Toolkit:

```bash
git clone https://github.com/X-Square-Robot/X2Streaming-TTS.git
cd X2Streaming-TTS
bash quickstart.sh --public
```

The launcher downloads and verifies both official model snapshots, builds the
matching TensorRT runtime, and starts the service. It prints **“您的 WebSocket 地址是……”**
only after receiving a completed real-audio response. Paste the complete address
into the Demo's **Live playground / 实时体验**.

The first build takes time. `--public` creates a temporary public WSS tunnel;
keep its random access path private. The website itself does not host GPU inference.
[Download the starter ZIP](quickstart/x2streaming-quickstart.zip) or read the
[setup guide, requirements and validation limits](https://github.com/X-Square-Robot/X2Streaming-TTS/blob/main/docs/quickstart.md).
The launcher is MIT-licensed; model weights retain Apache-2.0.

<video controls preload="none" src="assets/native_cursor_lab.mp4" width="900"></video>

[Watch the original session with audio](assets/native_cursor_lab.mp4).
Recordings show the reference system; local NativeCursor and speech-state features
remain subject to the runtime's manifest and capability release checks.

中文：先看录屏了解能力；需要自己输入文本时，在 GPU 机器运行上面的脚本。
首次下载、编译完成且音频检查通过后，复制终端输出的完整地址到网页“实时体验”。

## Files

| File | Size | SHA-256 |
| --- | --: | --- |
| `qwen3_tts_12hz_la1_seed0.pt` | 8.17 MB | `aa94527fddff97cca0c337529a3b840b141d8301c4a6082557984438a7e584bc` |

## Compatibility

| | |
| --- | --- |
| Backbone | Qwen3-TTS 12 Hz `custom-1.7b` native tokens: codec vocabulary 3072, 80 ms frames |
| Released against | [x-square-robot/X2Streaming-TTS-1.7B](https://huggingface.co/x-square-robot/X2Streaming-TTS-1.7B) (speaker `robot_service_v1`), the checkpoint served by the engine during validation |
| Labels | 503 spoken labels: 477 pinyin syllables + 26 English letters (`en_unit=letter`) |
| Lookahead | 1 native frame (80 ms); left context 29 frames |
| Parameters | 2,036,991 (label embedding tied to the content classifier) |
| Runs on | Fused TensorRT graph in the current Demo runtime; historical CPU reference measurements are reported below |
| Engine version | The exact public commit is pinned by the [quick-start manifest](https://github.com/X-Square-Robot/X2Streaming-TTS/blob/main/tools/quickstart/manifest.json) |

The head is voice- and backbone-specific. For another checkpoint, voice or codec,
re-train and validate the observer before enabling native progress.

## Usage

Use the launcher above to download both matching snapshots and stage this head for
fused TensorRT export. It verifies the head SHA-256 and keeps the original files
unchanged. The runtime checks the model/engine manifest and release validation
evidence before advertising `native_cursor.progress_available`.

Downloading this file alone does not enable native highlighting. If release checks
have not passed, the service reports the capability as unavailable and the Demo
labels any other progress as engine progress. There is no CPU sidecar fallback in
this deployment. The historical `text_progress.estimator: native` configuration is
not the setup interface for this newer runtime.

The paper's CPU reference and its evaluation results below describe the evaluated
reference implementation, not latency measurements of this TensorRT deployment.

## How it works

1. **TNPlan** turns the committed text into spoken labels (the normalized reading) and
   records which span of the original text owns each label, so the projection back to
   the raw text stays exact when reading order differs from writing order
   (`99%` → 百分之九十九).
2. A **native-token encoder** (four dilated convolution blocks, hidden size 256) embeds
   each codebook-0 token with one frame of lookahead.
3. A **local matcher** scores the labels at offsets −2 … +4 around the previous position
   against the token feature and a small location state, and moves a continuous
   internal position by the expected offset.
4. The **published cursor** is the high-water mark of that position mapped to the
   furthest raw-text span end reached; it is monotone by construction.

Training uses onset times from Qwen3-ForcedAligner as supervision, on 20,235 utterances
synthesized by the deployed custom voice, for 10 epochs (seed 0). Only the observer is
trained.

## Evaluation

**Research evaluation** (800 held-out texts in four groups of 200: plain Chinese,
Chinese with numbers, Chinese with symbols, English; text supplied in 2–8 character
chunks; reference = Qwen3-ForcedAligner; mean of three seeds):

| Method | Online | Lookahead | Params | MAE zh (chars) ↓ | MAE en ↓ | Onset F1@80 ms ↑ |
| --- | :-: | --: | --: | --: | --: | --: |
| WindowMMS+PersistentCTC (online waveform) | ✓ | 320 ms | 315.5 M | 1.253 | 2.226 | 0.341 |
| Cross-attention readout (native tokens) | ✗ | 320 ms | 2.490 M | 0.414 | 1.629 | 0.828 |
| CodecCTC+skip-DP (native tokens) | ✓ | 320 ms | 1.705 M | 0.416 | 1.568 | 0.823 |
| **X2-NativeCursor** | ✓ | **80 ms** | 2.166 M | **0.151 ± 0.005** | **1.247** | **0.924** |

Real-time factor 0.0180 against 0.3598 for the online waveform baseline.

**Engine acceptance** of this exact head (the engine's own audio on 80 held-out
utterances, live `text_progress` anchors, same reference):

| Metric | Value |
| --- | --- |
| Raw-character MAE | 0.215 (95% CI 0.166–0.280) |
| Onset F1 @ 80 ms | 0.928 |
| Backward steps | 0 in 6,441 anchors |
| Observer cost per frame, p50 / p90 at 1 session (CPU) | 4.2 / 5.5 ms |
| Observer cost per frame, p50 / p90 at 16 sessions (CPU) | 13.6 / 17.4 ms |

One native frame represents 80 ms of speech, so the observer stays inside its budget at
these concurrency levels.

## Limitations

- Trained for one voice and one backbone; accuracy drops on other voices (mean MAE 0.772
  on three voices outside training in the research ablation). Re-train for a new voice.
- This released head uses English letter labels (`en_unit=letter`), as shown in
  Compatibility. English accuracy remains lower than Chinese in the research evaluation.
- The historical CPU reference recomputes a 31-frame window per native frame; its
  measured costs are not performance claims for the newer fused TensorRT runtime.

## Citation

For X2-NativeCursor, please cite the [paper](https://arxiv.org/abs/2609.09677):

```bibtex
@article{liu2026x2nativecursor,
  title   = {X2-NativeCursor: Native-Token Text Progress Tracking for Incremental-Text Streaming Codec TTS},
  author  = {Liu, Zehan and Chen, Carl and Wen, Rime and Fu, Kaiqi and Lin, Altman and Qin, Shawn and Shi, Lights and Gan, Roy and Wang, Hao and Wang, Qian},
  journal = {arXiv preprint arXiv:2609.09677},
  year    = {2026},
  url     = {https://arxiv.org/abs/2609.09677},
}
```

If you also use the X2Streaming-TTS streaming method, please cite:

```bibtex
@article{wen2026x2streamingtts,
  title   = {X2Streaming-TTS: Causal Token-Level Text-to-Speech from Streaming Text with Speech-State Inheritance},
  author  = {Wen, Rime and Liu, Zehan and Qin, Shawn and Shi, Lights and Gan, Roy and Wang, Hao and Wang, Qian},
  journal = {arXiv preprint arXiv:2608.18661},
  year    = {2026},
}
```

## License

See [LICENSE](LICENSE) for the full Apache-2.0 terms and [NOTICE](NOTICE) for
component provenance and attribution.

Apache License 2.0, Copyright (c) 2026 XSquareRobot. The head is used together with
Qwen3-TTS models (Apache-2.0, Qwen team) and the Qwen3-ForcedAligner reference
(Qwen3-ASR, Apache-2.0) was used only for training supervision.

## 中文简介

X2-NativeCursor 是一个约 2M 参数的朗读进度观察器：它读取 Qwen3-TTS Talker 每 80 ms
输出的 codebook-0 token，在波形解码之前给出"现在读到原文第几个字"，位置始终向前。
TTS 生成器、语音 tokenizer 与声码器保持原样。本仓库存放发布的观察器头，对应
`x-square-robot/X2Streaming-TTS-1.7B` 的音色。新版 Qwen3TTS-Streaming 引擎通过融合导出及发布能力验证后启用它；
请使用上方快速启动脚本，
进度沿用现有的 `text_progress` 事件下发。换音色或换模型需要重新训练并验证。
许可为 Apache-2.0。

论文已公开：[X2-NativeCursor: Native-Token Text Progress Tracking for Incremental-Text Streaming Codec TTS](https://arxiv.org/abs/2609.09677)。
