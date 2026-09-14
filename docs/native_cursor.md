**English** | [简体中文](native_cursor.zh-CN.md)

> **Current Demo runtime:** The [quick start](quickstart.md) downloads the matching fused TensorRT engine. The CPU configuration and timings below describe the historical reference integration; current capabilities remain subject to runtime release checks.

# X2-NativeCursor: reading progress from native tokens

> Status: observer weights are available at
> [`x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz`](https://huggingface.co/x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz).
> The historical CPU runtime is not bundled in this method repository. Configuration
> below describes the reference implementation used for evaluation. The hook patches
> in this repository target upstream commit `0745e4a8`, which predates the observer.

## The problem

A token-level streaming TTS system starts speaking before the sentence is finished.
The client therefore receives audio chunks without knowing which characters of the
source text they carry. Anything that needs that position, such as highlighting the
text as it is read, accounting for what was actually heard when the user barges in,
subtitle timing, or updating dialogue history, has to reconstruct it.

Two obvious answers both fall short. A fixed audio-frames-per-token ratio is a guess,
not an alignment: it drifts within a sentence and breaks whenever the spoken order
differs from the written order (`23%` is read 百分之二十三, sign first). A waveform
aligner recovers the position from audio, but it needs a second acoustic model per
stream, adds lookahead, and can only start after the vocoder has produced samples.

## The idea

Codec-based TTS produces discrete speech tokens before it decodes them into a
waveform. Those tokens already carry content and timing. X2-NativeCursor reads them
directly:

1. **TNPlan** turns the text committed so far into *spoken labels* (the normalized
   reading) and records which span of the original text owns each label. All labels
   of `99%` share the span of `99%`, so the projection back to the raw text is exact
   even when reading order and writing order differ. Labels are released only once
   their reading can no longer change.
2. A **native-token encoder** embeds each codebook-0 token the Talker emits (each
   represents 80 ms of speech on Qwen3-TTS) with a small stack of dilated convolutions and one frame of
   lookahead.
3. A **local matcher** scores the labels around the previous position (offsets −2 to
   +4) against the current token feature and a small location state (fractional
   position, dwell time, recent advance), then moves a continuous internal position by
   the expected offset. The internal estimate may step back or skip labels.
4. The **published cursor** is the high-water mark of the internal position, mapped to
   the furthest raw-text span end reached. It is monotone by construction.

Only the observer (about 2M parameters) is trained, with onset times from
Qwen3-ForcedAligner as supervision. The TTS generator, the speech tokenizer and the
waveform decoder are untouched, so the mechanism can be added to an existing deployment
without re-exporting the engine.

<div align="center">
  <img src="assets/native_cursor_method.png" width="900" alt="X2-NativeCursor overview">
</div>

## What it achieves

**Research evaluation** (Qwen3-TTS, 800 held-out texts in four groups of 200: plain
Chinese, Chinese with numbers, Chinese with symbols, English; text supplied in 2–8
character chunks; reference = Qwen3-ForcedAligner; three seeds):

| Method | Online | Lookahead | Params | MAE zh (chars) ↓ | MAE en ↓ | Onset F1@80 ms ↑ |
| --- | :-: | --: | --: | --: | --: | --: |
| MMS-FA (complete audio) | ✗ | ∞ | 315.5 M | 0.539 | 1.610 | 0.430 |
| CTC-segmentation (complete audio) | ✗ | ∞ | 315.5 M | 0.371 | – | 0.418 |
| WindowMMS+PersistentCTC (online waveform) | ✓ | 320 ms | 315.5 M | 1.253 | 2.226 | 0.341 |
| Cross-attention readout (native tokens) | ✓ | 320 ms | 2.490 M | 0.414 | 1.629 | 0.828 |
| CodecCTC+skip-DP (native tokens) | ✓ | 320 ms | 1.705 M | 0.416 | 1.568 | 0.823 |
| **X2-NativeCursor** | ✓ | **80 ms** | 2.166 M | **0.151 ± 0.005** | **1.247** | **0.924** |

The real-time factor drops from 0.3598 (online waveform baseline) to 0.0180. With
MMS-FA as an independent second reference the Chinese MAE is 0.206 and the ordering is
unchanged. Retraining the observer on CosyVoice2 tokens gives a Chinese MAE of 0.284
with the same architecture.

<div align="center">
  <img src="assets/native_cursor_backbones.png" width="420" alt="Cursor tracking on Qwen3-TTS and CosyVoice2 under the same text stream">
  <p><em>The same sentence under the same text-arrival schedule on Qwen3-TTS (80 ms frames) and CosyVoice2 (40 ms frames). In this example, each cursor stays within two characters of its own reference and never runs ahead of the text received so far.</em></p>
</div>

**Engine acceptance** (the upstream engine's own audio on 80 held-out utterances,
live `text_progress` anchors, same reference):

| Metric | Value |
| --- | --- |
| Raw-character MAE | 0.215 (95% CI 0.166–0.280) |
| Onset F1 @ 80 ms | 0.928 |
| Backward steps | 0 in 6,441 anchors |
| Observer cost per frame, p50 (1 / 4 / 16 sessions, CPU) | 4.2 / 6.6 / 13.6 ms |
| Observer cost per frame, p90 (1 / 4 / 16 sessions, CPU) | 5.5 / 8.5 / 17.4 ms |

One native frame represents 80 ms of speech, so the observer stays far inside its
budget at these concurrency levels.

<div align="center">
  <img src="assets/native_cursor_concurrency.png" width="420" alt="Per-frame observer cost at 1, 4 and 16 concurrent sessions">
  <p><em>Separate GPU measurement from the paper on one A800: median model forward and median / p90 for a complete cursor update. The table above reports CPU reference-integration timings.</em></p>
</div>

## Live demo

<div align="center">
  <img src="assets/native_cursor_lab.gif" width="820" alt="OrangePilot lab page">
</div>

The recording shows the reference integration's lab page
talking to a live engine over its native WebSocket. Every highlight step and every
point on the trajectory is a real `text_progress` anchor. The full clip with the
session's own audio is [`assets/native_cursor_lab.mp4`](assets/native_cursor_lab.mp4).

## Reference integration

Download the observer head:

```bash
hf download x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz \
  --local-dir ./weights/X2-NativeCursor-Qwen3TTS-12Hz
```

The following configuration requires an engine build that includes the NativeCursor
historical CPU runtime integration, rather than the newer fused Demo runtime. In that build, place the
head under `resources/native_cursor/` and select the native estimator:

```yaml
# engine.yaml
text_progress:
  estimator: native                      # ema (default) | native
  native_head_path: resources/native_cursor/qwen3_tts_12hz_la1_seed0.pt
  native_device: auto                    # auto (= cpu) | cpu | cuda | cuda:N
```

In the reference implementation, `ENGINE_TEXT_PROGRESS_ESTIMATOR=native` selects the
same estimator. The observer runs on the frontend thread; `auto` resolves to CPU.

Anchors use the existing `text_progress` event schema. Clients use the playback clock
to map generated-audio progress to the position actually played. Each anchor carries
`progress_basis = native_cursor_v1` and
`progress_quality = aligned`; the built-in `ema` estimator remains the fallback when
the head is not loaded or the session has no native tokens yet.

## Relation to this repository

X2-NativeCursor is a companion to the paper method rather than part of it. Causal
commitment decides *what* may be spoken and *when* a segment closes; speech-state
inheritance decides *how* the next segment continues; X2-NativeCursor reports *where*
in the text the audio currently is. It reuses the same TNPlan owner spans that causal
commitment produces, which is why the cursor can be exact across normalized
expressions.

The hook patches in this repository target upstream commit `0745e4a8`, which predates
the observer. Running both mechanisms together requires the patch series to be rebased
onto an engine build that includes the matching NativeCursor runtime integration.
