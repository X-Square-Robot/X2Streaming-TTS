# Contribution boundary

## X2Streaming-TTS code

The following capabilities are developed and maintained in this repository:

- causal commitment for ambiguous streaming text;
- capacity-aware, punctuation-aware online segmentation policies;
- causal speech-state inheritance across committed segments;
- the FP32 text-acoustic bridge and fixed causal positional bias;
- compatibility adapters, parity tests and method-specific observability.

## Upstream code

The inference engine, scheduler, KV pool, gateways, protocol, client SDK,
TensorRT/ONNX export pipeline and deployment system belong to
Qwen3TTS-Streaming and are referenced through a pinned git submodule.

Integration patches must contain only generic lifecycle hooks, configuration
wiring and type conversion. Method algorithms must remain under
`src/x2streaming_tts`.

## Excluded assets

This repository distributes code only. It does not distribute papers,
datasets, experiment results, model weights, generated audio, listener data,
TensorRT plans or ONNX artifacts.
