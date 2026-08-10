# X2Streaming-TTS

[English](README.md) | 简体中文

X2Streaming-TTS 是
[Qwen3TTS-Streaming](https://github.com/X-Square-Robot/Qwen3TTS-Streaming)
的纯代码扩展，为异步到达的文本提供因果承诺（causal commitment），并在已承诺的
声学片段之间提供因果语音状态继承（causal speech-state inheritance）。

本仓库是论文 *X2Streaming-TTS: Causal Token-Level Text-to-Speech from Streaming
Text with Speech-State Inheritance* 的参考实现，引用信息见
[CITATION.cff](CITATION.cff)。

基础推理引擎、调度器、协议、网关、导出流水线与部署系统均保留在上游仓库，本仓库
以固定版本的 git submodule 引用。本仓库不分发研究数据集、实验结果、模型权重、
生成音频或 TensorRT 产物。

## 当前状态

代码抽取与两个补丁构成的端到端 hook 序列均已实现，并已在 RTX 4090 D 上用真实的
`custom-1.7b` TensorRT checkpoint 跑通。在第一个 release candidate 之前，更广泛的
故障注入、并发与长流验证仍在进行中。

## 快速开始

```bash
git clone --recursive https://github.com/X-Square-Robot/X2Streaming-TTS.git
cd X2Streaming-TTS
python scripts/verify_upstream.py
python -m pip install -e ".[test]"
pytest -q
```

如果克隆时没有加 `--recursive`：

```bash
git submodule update --init --recursive
```

在通用 hook 于上游走评审流程期间，可以把已校验的补丁队列应用到一个一次性
worktree 上。保持所引用的 submodule 本身干净，可以让溯源校验具备确定性：

```bash
python scripts/verify_upstream.py
python scripts/verify_patches.py
hook_tree="$(mktemp -d)/Qwen3TTS-Streaming"
git -C third_party/Qwen3TTS-Streaming worktree add --detach "$hook_tree" \
  0745e4a8613f0780cc57475452ee775a9abac2dd
for patch in "$PWD"/patches/upstream/0745e4a8613f0780cc57475452ee775a9abac2dd/*.patch; do
  git -C "$hook_tree" apply "$patch"
done
```

构造 session 级策略对象，无需导入或复制任何上游代码：

```python
from x2streaming_tts import X2StreamingPolicy
from x2streaming_tts.adapters.qwen3tts_streaming import build_policy_factories
from x2streaming_tts.commitment.text_normalizer import (
    get_wetext_chinese_normalizer,
)

policy = X2StreamingPolicy(text_normalizer=get_wetext_chinese_normalizer())
extensions = build_policy_factories(policy).to_upstream()
# 将 extensions=extensions 传给打过补丁的上游 TTSEngine 构造函数。
```

第一个补丁负责 session 级策略对象的归属与失效。第二个补丁接入文本承诺、解码观测、
健康门控的片段收尾、不可变的 Code2Wav 快照、后继片段的状态恢复以及文本—声学桥。
策略抛出的异常一律 fail closed，回落到上游原有路径。

`X2StreamingPolicy` 只暴露论文所报告的方法：因果承诺与因果语音状态继承。它不暴露
历史的 profile 选择器、QK 一致性注意力轨迹、Talker KV-cache 直接搬运，以及音频
边界裁剪。论文中的固定因果注意力先验与有界残差注入属于已发布方法的一部分，实现
位于 `inheritance/speech_state_inheritance.py`。

## 论文对照

| 论文内容 | 代码位置 |
| --- | --- |
| 不确定性感知的语义就绪判定、`E_t`/`U_t` 划分 | `commitment/rule_boundary.py` |
| 已释放文本片段的正则化 | `commitment/text_normalizer.py`、`commitment/text_normalization.py` |
| 延迟反馈的容量 EMA 与预测容量 | `commitment/capacity.py`（`AdaptiveCapacityEstimator`） |
| 因果的标点感知停止规则与第四档硬切 | `commitment/capacity.py`（`CausalCommitmentController`） |
| 两条独立状态通路与健康门 | `inheritance/speech_state_inheritance.py` |
| 固定因果注意力先验与有界注入 | `inheritance/speech_state_inheritance.py`（`build_text_acoustic_bridge`） |

论文报告的超参数就是 `config.py` 中的默认值：初始扩张比 6.0、EMA 权重 0.1（溢出后
0.5）、比值裁剪区间 `[2, 10]`、三档阈值 `(0.7, 0.8, 0.9)`、健康门比值区间
`[1, 12]`、继承的 Talker 历史长度 `H = 4`、内容项系数 2.0、残差增益上界 0.015。
位置先验 `text_acoustic_bridge_position_bias` 即论文中 `b(d)` 的查表形式。

与论文一致，可用的 cache 上限从所加载的引擎读取：打过补丁的切分器把自己 prefill
之后的预算传给 `split_thresholds`，策略再据此推导容量。
`CapacityConfig.decode_budget` 仅作为无引擎上报预算时独立运行的回退值。

## 代码边界

- `src/x2streaming_tts/`：X2Streaming-TTS 方法代码。
- `third_party/Qwen3TTS-Streaming/`：固定版本的上游源码与历史。
- `patches/upstream/`：在对应的通用 hook 提交上游期间所需的最小集成补丁。
- `tests/`：方法、兼容性与溯源校验。

归属与许可边界见 [CONTRIBUTIONS.md](CONTRIBUTIONS.md) 与
[THIRD_PARTY.md](THIRD_PARTY.md)，上游集成规则见
[patches/README.md](patches/README.md)。

## 许可

X2Streaming-TTS 代码以 MIT 许可发布，Copyright (c) 2026 XSquareRobot。
第三方组件各自保留其原有许可。
