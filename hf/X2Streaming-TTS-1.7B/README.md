---
license: apache-2.0
base_model: Qwen/Qwen3-TTS-12Hz-1.7B-Base
pipeline_tag: text-to-speech
language:
  - zh
  - en
tags:
  - qwen3-tts
  - text-to-speech
  - streaming
  - token-level
  - custom-voice
  - tensorrt
  - x2streaming-tts
  - arxiv:2608.18661
  - arxiv:2609.09677
---

<div align="center">
  <img src="assets/x-square-logo.png" width="140" alt="X Square Robot beaver mascot holding the moon">
  <h1>X2Streaming-TTS-1.7B</h1>
  <p><strong>The deployed CustomVoice checkpoint behind X2Streaming-TTS</strong></p>
  <p>
    <a href="https://github.com/X-Square-Robot/X2Streaming-TTS"><img src="https://img.shields.io/badge/GitHub-X2Streaming--TTS-black" alt="X2Streaming-TTS"></a>
    <a href="https://github.com/X-Square-Robot/Qwen3TTS-Streaming"><img src="https://img.shields.io/badge/Engine-Qwen3TTS--Streaming-6f42c1" alt="Qwen3TTS-Streaming"></a>
    <a href="https://arxiv.org/abs/2608.18661"><img src="https://img.shields.io/badge/arXiv-2608.18661-b31b1b" alt="paper"></a>
    <a href="https://huggingface.co/x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz"><img src="https://img.shields.io/badge/Hugging%20Face-X2--NativeCursor-yellow" alt="X2-NativeCursor head"></a>
    <a href="https://arxiv.org/abs/2609.09677"><img src="https://img.shields.io/badge/arXiv-2609.09677-b31b1b" alt="X2-NativeCursor paper"></a>
  </p>
</div>

<div align="center">
  <img src="assets/native_cursor_use_cases.png" width="1000" alt="X2Streaming-TTS and X2-NativeCursor: streaming speech, continuous narration, synchronized highlighting, playback-aware interruption, and dialogue-history updates">
  <p><em>Speak as text arrives, track reading progress, and use the playback clock to keep interruptions and dialogue history aligned with played audio.</em></p>
</div>

X2Streaming-TTS-1.7B is a Qwen3-TTS 12 Hz CustomVoice model with one built-in
Mandarin voice, `robot_service_v1`, fine-tuned by X Square Robot from
[Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base).
It is the checkpoint served by the
[Qwen3TTS-Streaming](https://github.com/X-Square-Robot/Qwen3TTS-Streaming) engine in
X Square Robot's spoken-dialogue stack and the checkpoint the
[X2Streaming-TTS](https://github.com/X-Square-Robot/X2Streaming-TTS) method and the
[X2-NativeCursor](https://huggingface.co/x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz)
progress observer are released against.

The files are in the standard Qwen3-TTS Hugging Face layout, so the checkpoint loads
with the `qwen_tts` Python package for offline synthesis and exports unchanged through
the Qwen3TTS-Streaming pipeline for token-level streaming on TensorRT.

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

## Model details

| | |
| --- | --- |
| Architecture | `Qwen3TTSForConditionalGeneration`, 1.7B Talker + Code Predictor, 12 Hz multi-codebook speech tokenizer, Code2Wav decoder |
| Base model | Qwen/Qwen3-TTS-12Hz-1.7B-Base |
| Model type | `custom_voice` (built-in speaker table) |
| Speaker | `robot_service_v1` (speaker id 3000), a Mandarin service-assistant voice |
| Languages | Mandarin Chinese (primary), English (secondary) |
| Output | 24 kHz mono waveform |
| Precision | bfloat16 weights |
| Release version | `cont7e3-f2b8ed5` (`MODEL_VERSION` source file; newer package identifiers are documented below) |
| License | Apache-2.0 |

## Files

| File | Size | SHA-256 |
| --- | --: | --- |
| `model.safetensors` | 3.83 GB | `666b32d4b73e861d39aad1495d95b6fa5dacad186c42d00ff39d52297cf67966` |
| `config.json` | 4.5 KB | `c9bb0eedce066142902c7c219585189acb559d66cca956f08ca8731581a437c3` |
| `generation_config.json` | 245 B | `f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa` |
| `preprocessor_config.json` | 127 B | `efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119` |
| `tokenizer_config.json` | 7.3 KB | `dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670` |
| `vocab.json` | 2.78 MB | `ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910` |
| `merges.txt` | 1.67 MB | `599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3` |
| `MODEL_VERSION` | 15 B | `46a822304a74dcb49ce29ed087590c042ea59d57737882394c7d456c3649ef14` |
| `speech_tokenizer/model.safetensors` | 0.68 GB | `836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258` |
| `speech_tokenizer/config.json` | 2.3 KB | `ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167` |
| `speech_tokenizer/configuration.json` | 76 B | `6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd` |
| `speech_tokenizer/preprocessor_config.json` | 234 B | `fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb` |

`SHA256SUMS` in the repository lists the same digests in `sha256sum` format.

## Quick start

### Download

```bash
pip install -U huggingface_hub
hf download x-square-robot/X2Streaming-TTS-1.7B \
  --local-dir ./weights/X2Streaming-TTS-1.7B
```

### Offline synthesis with `qwen_tts`

Install the official package from [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS),
then call `generate_custom_voice` with the built-in speaker:

```python
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

model = Qwen3TTSModel.from_pretrained(
    "./weights/X2Streaming-TTS-1.7B",
    device_map="cuda:0",
    dtype=torch.bfloat16,
)
print(model.get_supported_speakers())   # ['robot_service_v1']

wavs, sr = model.generate_custom_voice(
    text="您好，我是服务助手，今天的室外温度是二十三摄氏度。",
    language="Chinese",
    speaker="robot_service_v1",
)
sf.write("output.wav", wavs[0], sr)
```

`generation_config.json` carries the sampling defaults used in production:
`temperature 0.9`, `top_k 50`, `top_p 1.0`, `repetition_penalty 1.05`.

### Token-level streaming with Qwen3TTS-Streaming

Use the pinned launcher above. It preserves this checkpoint's original files and
uses a separate `x2demo@<build-date>` package identifier for the newer engine's
version format. The source `cont7e3-f2b8ed5` identifier is recorded in local state.
The older research hook patches target a different engine revision and must not
be applied to the quick-start runtime.

### With the X2Streaming-TTS method

[X2Streaming-TTS](https://github.com/X-Square-Robot/X2Streaming-TTS) adds causal
commitment and causal speech-state inheritance on top of the engine through two hook
patches. Its README walks through applying the patches and running
`scripts/run_checkpoint_e2e.py` against this checkpoint.

### With the X2-NativeCursor progress observer

[X2-NativeCursor-Qwen3TTS-12Hz](https://huggingface.co/x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz)
is an 8.2 MB observer head that reads this model's codebook-0 tokens inside the engine
and publishes a reading cursor into the source text. Its model card explains how to
use it with the matching fused runtime and capability release checks. The [X2-NativeCursor paper](https://arxiv.org/abs/2609.09677)
describes the observer and its evaluation.

## Training summary

The voice was obtained by fine-tuning Qwen3-TTS-12Hz-1.7B-Base in two stages on an
internal synthetic Mandarin corpus for a single service-assistant speaker:

| Stage | Data | Epochs | Learning rate | Batch | Precision |
| --- | --- | --: | --: | --: | --- |
| 1 | 493 sentence-level utterances from an internal synthetic Mandarin corpus | 8 | 2e-6 | 8 | bf16 |
| 2 (this release) | the same 493 utterances, continued from stage 1 | 4 | 4e-7 | 8 | bf16 |

The speech tokenizer (`speech_tokenizer/`) is the official Qwen3-TTS-Tokenizer-12Hz,
included unchanged so that the directory is self-contained.

## Intended use and limitations

- **Intended use.** Mandarin spoken-dialogue and service-assistant applications that
  need low first-audio latency, in particular token-level streaming from an upstream
  language model through Qwen3TTS-Streaming.
- **Single voice.** The checkpoint contains one speaker. Instruction-based style
  control (`instruct`) is supported by the architecture but was not a training target
  for this voice.
- **English.** English text is synthesized, with lower naturalness than Mandarin.
- **Streaming caveats.** Token-level streaming can still produce hallucinated,
  repeated or dropped words on some inputs; the rate depends on the text and the
  segmentation policy. The engine's
  [known limitations](https://github.com/X-Square-Robot/Qwen3TTS-Streaming/blob/main/docs/user/known_limitations.md)
  and the X2Streaming-TTS paper describe the failure modes and the mitigations
  (causal commitment, health-gated state inheritance).
- **Numbers, dates and units.** Read the text through a text normalizer before
  synthesis; the X2Streaming-TTS release includes the Chinese normalizer used in the
  paper. Some date, time and unit formats are misread when passed raw.
- **Evaluation.** The streaming evaluation protocol and results for the method are in
  the [paper](https://arxiv.org/abs/2608.18661).

## Citation

```bibtex
@article{wen2026x2streamingtts,
  title   = {X2Streaming-TTS: Causal Token-Level Text-to-Speech from Streaming Text with Speech-State Inheritance},
  author  = {Wen, Rime and Liu, Zehan and Qin, Shawn and Shi, Lights and Gan, Roy and Wang, Hao and Wang, Qian},
  journal = {arXiv preprint arXiv:2608.18661},
  year    = {2026},
}
```

If you use the X2-NativeCursor progress observer with this checkpoint, also cite:

```bibtex
@article{liu2026x2nativecursor,
  title   = {X2-NativeCursor: Native-Token Text Progress Tracking for Incremental-Text Streaming Codec TTS},
  author  = {Liu, Zehan and Chen, Carl and Wen, Rime and Fu, Kaiqi and Lin, Altman and Qin, Shawn and Shi, Lights and Gan, Roy and Wang, Hao and Wang, Qian},
  journal = {arXiv preprint arXiv:2609.09677},
  year    = {2026},
  url     = {https://arxiv.org/abs/2609.09677},
}
```

## License

See [LICENSE](LICENSE) for the full Apache-2.0 terms and [NOTICE](NOTICE) for
component provenance and attribution.

The weights are released under the Apache License 2.0, Copyright (c) 2026 XSquareRobot.
They derive from Qwen3-TTS-12Hz-1.7B-Base and include the Qwen3-TTS-Tokenizer-12Hz,
both released by the Qwen team under Apache-2.0; their notices apply to the
corresponding components.

## 中文简介

X2Streaming-TTS-1.7B 是 X Square Robot 基于 Qwen3-TTS-12Hz-1.7B-Base 微调的
CustomVoice 模型，内置一个中文服务助手音色 `robot_service_v1`。它是 Qwen3TTS-Streaming
引擎在线服务所用的 checkpoint，也是 X2Streaming-TTS 方法与 X2-NativeCursor 进度观察器
发布时所对应的权重。文件采用 Qwen3-TTS 的标准 Hugging Face 布局：用 `qwen_tts` 包可以
离线合成，交给 Qwen3TTS-Streaming 的 `autorun` 流水线即可导出 TensorRT 做 token 级流式
合成。合成前请先做文本正则化（数字、日期、单位）。许可为 Apache-2.0。

论文：[X2Streaming-TTS](https://arxiv.org/abs/2608.18661)；如使用朗读进度观察器，
请同时引用 [X2-NativeCursor](https://arxiv.org/abs/2609.09677)。
