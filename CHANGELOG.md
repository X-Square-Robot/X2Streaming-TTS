**English** | [简体中文](CHANGELOG.zh-CN.md)

# Changelog

All notable changes to X2Streaming-TTS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[PEP 440](https://peps.python.org/pep-0440/).

## [Unreleased]

### Added

- README rebuilt around the paper: problem statement, the two mechanisms with the
  paper's figures, headline results, demo recordings, related projects and citation.
- X2-NativeCursor feature page (`docs/native_cursor.md`) describing the native-token
  progress observer that ships in the upstream `dev` branch, with its research and
  engine-acceptance numbers and the engine configuration to enable it.
- `docs/assets/` with the paper figures, the X2-NativeCursor method figure and the
  demo screen recordings used by the README.
- This changelog.

### Changed

- `CITATION.cff` now lists the authors as they appear on arXiv, carries the arXiv
  identifier and references the upstream engine and X2-Turn.
- `pyproject.toml` links the paper, the changelog and X2-Turn.
- `CONTRIBUTIONS.md` clarifies that `docs/assets/` holds documentation media, not
  research artifacts.

## [0.1.0.dev0] - 2026-08-06

### Added

- Initial public release of the method code: causal commitment
  (`src/x2streaming_tts/commitment/`) and causal speech-state inheritance
  (`src/x2streaming_tts/inheritance/`), with the `X2StreamingPolicy` facade and the
  Qwen3TTS-Streaming adapter.
- Two-patch upstream hook series for Qwen3TTS-Streaming commit `0745e4a8`, with
  `verify_upstream.py` and `verify_patches.py` provenance checks.
- Method, compatibility, GPU and provenance tests; checkpoint end-to-end, stress and
  bridge benchmark scripts.

[Unreleased]: https://github.com/X-Square-Robot/X2Streaming-TTS/compare/729ad1c...HEAD
[0.1.0.dev0]: https://github.com/X-Square-Robot/X2Streaming-TTS/commit/729ad1c
