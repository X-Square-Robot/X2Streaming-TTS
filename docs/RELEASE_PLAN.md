# Release plan

## Scope frozen for v0.1

The public method is `X2StreamingPolicy`. It always represents the two
cooperating mechanisms described by X2Streaming-TTS:

1. causal commitment: ambiguous-span buffering, normalization,
   capacity-adaptive commitment and punctuation-aware boundaries;
2. causal speech-state inheritance: complete Code2Wav state, an H=4 bounded
   text-acoustic hidden tail, immediate-predecessor gating, FP32 bridge math,
   fixed causal positional bias and fail-closed fallback.

Historical S40/profile selectors, QK traces or priors, direct Talker KV-cache
carry and EOS audio trimming/joining are not part of the release surface.

## Upstream boundary

Qwen3TTS-Streaming remains a pinned submodule at
`0745e4a8613f0780cc57475452ee775a9abac2dd`. The X2 package owns all method
algorithms. Upstream patches may only add generic lifecycle hooks, stable data
conversion, session ownership and invalidation.

Local patch delivery and an upstream pull request proceed in parallel:

- the patch queue gives every X2 release a reproducible engine integration;
- the upstream PR removes the long-term need to carry those generic hooks;
- upstream code, history and license attribution remain intact in both paths.

## Execution gates

### Gate 1: package and provenance — complete

- MIT license, Copyright (c) 2026 XSquareRobot;
- code-only wheel/sdist; no paper, data, results, weights, audio or engine
  artifacts;
- submodule SHA and patch SHA256 are machine-checked;
- wheel installs without forcing Torch, CUDA or TensorRT.

### Gate 2: unified method — complete

- one public `X2StreamingPolicy`, with no experimental profiles;
- causal commitment and speech-state inheritance have independent unit tests;
- tensor snapshots are deep-owned and inheritance fails closed;
- provenance tests reject removed historical mechanisms and audio-join paths.

### Gate 3: generic hook ownership — complete

- the first patch creates one commitment and one continuity object per session;
- session teardown invalidates inherited state;
- patched upstream tests for engine, frontend and session paths pass.

### Gate 4: lifecycle callback wiring — complete

The second minimal upstream patch invokes the external policies at:

1. text packet ingest and commitment;
2. decode-step observation and capacity feedback;
3. segment health decision and finalization;
4. successor prefill and Code2Wav state restoration.

Finalized Code2Wav state crosses the package boundary as an engine-owned,
deep-copied dataclass rather than a mutable slot. Policy exceptions fail
closed, retry capture is reset without opening the predecessor gate, and no X2
algorithm moved into the engine patch.

### Gate 5: real-checkpoint end-to-end — in progress

On the declared 4090 stack, run:

- a multi-segment stream with real WeText normalization and a real Qwen3-TTS
  checkpoint;
- future-text mutation tests against already committed decisions;
- predecessor failure, timeout, abort/resume and session-isolation cases;
- long text and concurrent sessions while recording TTFT, RTF and peak memory;
- X2 enabled/disabled comparison to separate upstream behavior from the method.

Completed: real WeText normalization, five-segment X2 synthesis, all five
health-gated snapshots, four successor Code2Wav restores, four prepared bridges
with 13--18 bridge applications per successor, exact no-pseudo-EOS frame
accounting, and an extension-disabled baseline. Fault injection, concurrent
session isolation and longer streams remain before this gate closes.

### Gate 6: release candidate — pending

- repeat bootstrap from a clean recursive clone;
- build and inspect wheel, sdist and SBOM;
- document the exact Python, Torch, CUDA, driver, GPU and upstream SHA;
- configure the repository remote and confirmed Git author identity;
- push the local patch queue and open the generic upstream-hook PR;
- publish `v0.1.0rc1`, then promote only after installation feedback.

## Current validation record

The isolated `4090-Host` run on 2026-08-06 produced:

- real WeText integration: 4 passed;
- X2 non-GPU suite: 66 passed, 1 skipped;
- X2 two-GPU suite: 6 passed;
- patched upstream targeted suite: 108 passed (latest lifecycle series);
- commitment stress: 100,000 tokens;
- inheritance stress: 2,000 segments per GPU, peak allocated 10,713,600 bytes;
- bridge benchmark: median 197.288 us on GPU 0 and 214.619 us on GPU 1.

After lifecycle wiring, the isolated real-checkpoint run on the same host
produced 552,960 audio bytes from exactly 72 non-EOS frames, five clean
`codec_eos` finalizations, four restored successor states and bridge apply
counts of 17, 15, 18 and 13. TTFT was 50.494 ms and request elapsed time was
1,133.516 ms for this single warm run; these are wiring diagnostics, not a
performance claim. The disabled baseline also completed normally (one segment,
576,000 audio bytes). The tested engine manifest reports bf16 Code Predictor,
so this result does not waive upstream's fp32-CP quality recommendation.
