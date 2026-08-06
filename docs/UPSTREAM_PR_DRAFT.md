# Upstream PR draft: generic streaming policy lifecycle hooks

## Proposed title

`feat(engine): add optional session-scoped extension lifecycle hooks`

## Proposed body

### Motivation

External streaming policies currently need to fork engine internals to own
per-session state. This change introduces optional factories for text
commitment and acoustic continuity. The upstream engine
owns policy lifetime; it does not import any external implementation.

### Scope

- add an `EngineExtensions` container of optional factories;
- construct commitment policies with frontend sessions;
- construct continuity policies with backend session groups;
- invalidate continuity state when a session is removed;
- commit only policy-released text and propagate semantic boundaries;
- expose decode hidden states to an optional observer;
- deep-copy finalized Code2Wav state into a stable dataclass before release;
- restore successor Code2Wav state and apply an opaque bridge callback;
- skip pseudo audio and C2W state commits on codec EOS;
- reset abandoned attempt capture on a safe lookahead retry;
- preserve identical behavior when no factories are supplied.

No X2Streaming-TTS algorithm, configuration schema or dependency is added to
Qwen3TTS-Streaming.

### Validation already performed

- patch applies cleanly to `0745e4a8613f0780cc57475452ee775a9abac2dd`;
- `git diff --check` and Python compilation pass;
- 108 targeted upstream CPU tests pass with `PYTHONPATH=.:client/src`;
- X2 package provenance, policy and adapter suite passes independently.
- a real RTX 4090 D checkpoint completed with five health-gated snapshots,
  four successor restores and nonzero bridge callback counts;
- the extension-disabled real-checkpoint baseline also completes.

The local queue keeps factory ownership and lifecycle wiring in two commits so
maintainers can review or land them separately. No X2 class, setting or method
name appears in upstream code.

## Maintainer checklist

- [ ] Rebase the patch onto the upstream default branch.
- [ ] Add upstream-owned unit tests for factory construction and invalidation.
- [ ] Confirm public naming and whether factories belong in `engine.core`.
- [ ] Run the complete upstream test suite and formatter.
- [ ] Open the PR from an XSquareRobot-owned branch.
- [ ] Link the accepted commit/tag in `UPSTREAM_LOCK.json` and remove the
      corresponding local patch at the next X2 release.
