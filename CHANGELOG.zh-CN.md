[English](CHANGELOG.md) | **简体中文**

# 更新日志

X2Streaming-TTS 的所有重要变更都记录在此。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[PEP 440](https://peps.python.org/pep-0440/)。

## [Unreleased]

### 新增

- Hugging Face 权重链接：`x-square-robot/X2Streaming-TTS-1.7B`（部署版 CustomVoice
  checkpoint）与 `x-square-robot/X2-NativeCursor-Qwen3TTS-12Hz`（进度观察器头），README
  新增模型表、徽章与下载步骤。
- README 围绕论文重建：问题陈述、两大机制及论文插图、核心结果、demo 录屏、相关项目与引用。
- X2-NativeCursor 功能页（`docs/native_cursor.zh-CN.md`），附研究评测、引擎验收数字与
  参考集成所用的配置。观察器权重单独发布，本次发布尚未包含运行时集成。
- `docs/assets/`：README 使用的论文插图、X2-NativeCursor 方法图与 demo 录屏。
- 本更新日志。

### 变更

- 修正本地 checkpoint 导出步骤、NativeCursor 发布范围与对照数据，下载示例更新为 `hf` CLI。
- 在 `THIRD_PARTY.md` 与 `NOTICE` 中补充模型和文本正则化依赖的来源声明。
- `CITATION.cff` 作者署名改为与 arXiv 一致，补充 arXiv 标识，并引用上游引擎与 X2-Turn。
- `pyproject.toml` 增加论文、更新日志与 X2-Turn 的链接。
- `CONTRIBUTIONS.md` 说明 `docs/assets/` 存放的是文档媒体。

## [0.1.0.dev0] - 2026-08-06

### 新增

- 方法代码首次公开：因果承诺（`src/x2streaming_tts/commitment/`）与因果语音状态继承
  （`src/x2streaming_tts/inheritance/`），附 `X2StreamingPolicy` 门面与
  Qwen3TTS-Streaming 适配器。
- 针对 Qwen3TTS-Streaming 提交 `0745e4a8` 的两个上游 hook 补丁，以及
  `verify_upstream.py` 与 `verify_patches.py` 溯源校验。
- 方法、兼容性、GPU 与溯源测试；checkpoint 端到端、压力与桥基准脚本。

[Unreleased]: https://github.com/X-Square-Robot/X2Streaming-TTS/compare/729ad1c...HEAD
[0.1.0.dev0]: https://github.com/X-Square-Robot/X2Streaming-TTS/commit/729ad1c
