# X2Streaming-TTS

X2Streaming-TTS is a code-only extension for
[Qwen3TTS-Streaming](https://github.com/X-Square-Robot/Qwen3TTS-Streaming).
It provides causal commitment for asynchronously arriving text and causal
speech-state inheritance across committed acoustic segments.

The base inference engine, scheduler, protocol, gateways, export pipeline and
deployment system remain in the upstream repository and are referenced as a
pinned git submodule. This repository does not redistribute research datasets,
experiment results, model weights, generated audio or TensorRT artifacts.

## Status

The code extraction and two-patch end-to-end hook series are implemented. The
series has been exercised with a real `custom-1.7b` TensorRT checkpoint on an
RTX 4090 D; broader fault, concurrency and long-stream validation remains in
progress before the first release candidate.

## Bootstrap

```bash
git clone --recursive https://github.com/X-Square-Robot/X2Streaming-TTS.git
cd X2Streaming-TTS
python scripts/verify_upstream.py
python -m pip install -e ".[test]"
pytest -q
```

If the repository was cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

The verified patch queue can be applied to a disposable worktree while the
generic hooks are reviewed upstream. Keeping the pinned submodule itself clean
makes provenance checks deterministic:

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

Construct session-scoped policies without importing or copying upstream code:

```python
from x2streaming_tts import X2StreamingPolicy
from x2streaming_tts.adapters.qwen3tts_streaming import build_policy_factories
from x2streaming_tts.commitment.text_normalizer import (
    get_wetext_chinese_normalizer,
)

policy = X2StreamingPolicy(text_normalizer=get_wetext_chinese_normalizer())
extensions = build_policy_factories(policy).to_upstream()
# Pass extensions=extensions to the patched upstream TTSEngine constructor.
```

The first patch establishes ownership and invalidation of session-scoped
policy objects. The second patch wires commitment, decode observation,
health-gated finalization, immutable Code2Wav snapshots, successor restoration
and the text-acoustic bridge. Policy exceptions fail closed to the upstream
path.

`X2StreamingPolicy` exposes exactly the method reported in the paper: causal
commitment plus causal speech-state inheritance. It does not expose historical
profile selectors, attention-trace priors, direct Talker KV-cache carry or
audio-boundary trimming.

## Code boundary

- `src/x2streaming_tts/`: X2Streaming-TTS method code.
- `third_party/Qwen3TTS-Streaming/`: pinned upstream source and history.
- `patches/upstream/`: minimal integration hooks while the corresponding
  generic hooks are proposed upstream.
- `tests/`: method, compatibility and provenance checks.

See [CONTRIBUTIONS.md](CONTRIBUTIONS.md) and
[THIRD_PARTY.md](THIRD_PARTY.md) for attribution and license boundaries. The
remaining integration and release gates are tracked in
[docs/RELEASE_PLAN.md](docs/RELEASE_PLAN.md).

## License

X2Streaming-TTS code is MIT licensed, Copyright (c) 2026 XSquareRobot.
Third-party components retain their own licenses.
