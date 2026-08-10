# Patch series for 0745e4a

This series is based on Qwen3TTS-Streaming commit
`0745e4a8613f0780cc57475452ee775a9abac2dd`.

## 0001: extension policy factories

The first patch introduces dependency-free, session-scoped factories for
commitment, continuity and audio-join policies. It wires ownership through
`TTSEngine`, `FrontendInterface`, frontend `Session` and `EngineSessionGroup`,
and invalidates continuity state when a backend session is removed.

It intentionally does not contain X2 algorithms. Subsequent patches will add
the stable lifecycle calls needed to consume the policies. The API is designed
for submission as a generic upstream extension surface.

Validation performed while generating this patch:

- `git diff --check` passed;
- Python compilation passed;
- 72 targeted upstream frontend/engine/server unit tests passed with
  `PYTHONPATH=.:client/src`.
