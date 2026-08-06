# Upstream hook proposal

## Objective

Allow external streaming policies to integrate with Qwen3TTS-Streaming without
forking its engine or embedding method-specific algorithms in upstream code.

## Proposed hooks

### Commitment policy

- called after transport cleanup and before tokenization;
- accepts text packets plus an end-of-input signal;
- returns safe-to-tokenize spans and explicit semantic boundaries;
- receives completed-segment capacity observations through a separate method.

### Continuity policy

- observes decode steps without owning the scheduler;
- snapshots a finalized segment after the upstream health result is known;
- supplies an optional continuation context before successor prefill;
- receives a deep-owned `C2WContinuationState` dataclass, never a mutable slot
  or KV-pool handle;
- may restore Code2Wav state through explicit state adapters;
- may prepare and apply an opaque successor bridge state;
- fails closed to the normal upstream path.

## Upstream constraints

- hooks are disabled by default;
- no dependency from upstream to X2Streaming-TTS;
- protocol and gateway behavior remain unchanged when hooks are absent;
- policy failures invalidate the extension state and fall back safely;
- hook inputs use stable dataclasses rather than mutable engine internals;
- observability identifies the active policy and its version.

## Parallel delivery

The first X2Streaming-TTS release uses two ordered patches against the pinned
commit: factory ownership, then lifecycle callbacks. A separate upstream pull
request will propose the same generic interfaces; once merged and released,
the local patch series can be removed.
