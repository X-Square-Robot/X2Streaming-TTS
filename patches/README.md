# Upstream integration patches

This directory contains the temporary, minimal hook series required to load
X2Streaming-TTS policies in the pinned Qwen3TTS-Streaming engine.

Rules:

1. patches may add lifecycle hooks, configuration wiring and type conversion;
2. X2 method algorithms must stay under `src/x2streaming_tts`;
3. every patch series is stored under the exact upstream commit SHA;
4. CI must run `git apply --check` before integration tests;
5. the same generic hooks are proposed upstream in parallel.

