"""Causal speech-state inheritance for X2Streaming-TTS.

``finalize_segment`` is the health gate. Code2Wav fields form the
waveform-state path, and ``build_text_acoustic_bridge`` carries a bounded
Talker-state path across segment boundaries.

The method carries the complete Code2Wav state plus the final four
token-aligned Talker hidden states through a strict-causal text--acoustic
bridge. Historical QK-consensus attention traces and direct Talker KV-cache
carry are deliberately not part of this implementation; a fixed causal
attention prior is.
"""

from __future__ import annotations

import logging
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import torch
import torch.nn.functional as F

from ..config import SpeechStateInheritanceConfig

logger = logging.getLogger(__name__)


class ContinuityStats:
    """Engine-wide SCS continuity counters, aggregated across sessions.

    ``CausalSpeechStateInheritance`` is per-session, so observable counters live at
    module level and every tracker increments the shared instance.  The
    categories are disjoint per finalized segment: ``carried_ok`` plus the sum
    of ``chain_broken`` covers all finalizations; ``invalidated`` counts
    explicit chain invalidations (cancel / replace / error paths).

    Written on the engine thread, read from the asyncio thread via
    ``health_stats()`` — observability-only int increments under the GIL,
    no locking needed.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.carried_ok: int = 0
        self.invalidated: int = 0
        # health-gate break reason -> count (for example ``eos_reason``,
        # ``input_incomplete``, ``text_unconsumed``, ``ratio_outlier`` or
        # ``c2w_snapshot_failed``).
        self.chain_broken: dict[str, int] = {}

    def on_chain_broken(self, reason_key: str) -> None:
        self.chain_broken[reason_key] = self.chain_broken.get(reason_key, 0) + 1

    def snapshot(self) -> dict:
        return {
            "carried_ok": self.carried_ok,
            "invalidated": self.invalidated,
            "chain_broken_total": sum(self.chain_broken.values()),
            "chain_broken": dict(self.chain_broken),
        }


CONTINUITY_STATS = ContinuityStats()


@dataclass(frozen=True)
class TextAcousticBridgeOutput:
    """One parameter-free text-to-acoustic bridge update on device."""

    context: torch.Tensor  # [1, 1, H]
    gate: torch.Tensor  # scalar, bounded by configured strength
    center: torch.Tensor  # scalar monotonic text position
    confidence: torch.Tensor  # scalar inverse normalized entropy


@dataclass
class TextAcousticBridgeState:
    """Opaque per-successor bridge state owned by the X2 policy."""

    memory: torch.Tensor
    acoustic_history_len: int
    center: Optional[torch.Tensor] = None
    updates: int = 0


def build_text_acoustic_bridge(
    *,
    query: torch.Tensor,
    text_memory: torch.Tensor,
    previous_center: Optional[torch.Tensor],
    settings: SpeechStateInheritanceConfig,
    current_text_index: Optional[int] = None,
) -> Optional[TextAcousticBridgeOutput]:
    """Attend from a Talker acoustic state to arrived text embeddings.

    ``content_logits + position_logits`` plus a strict future mask form the
    causal attention prior. The returned context and bounded ``gate`` are
    consumed by ``EngineLoop._apply_text_acoustic_bridge`` as a residual
    injection. Future positions receive no finite logit.

    This is the inference-only identity-projection version of the bridge.
    Learned ``Wq/Wk/Wv/Wb`` matrices would be meaningless without training,
    so the existing hidden/embedding space is reused. A Gaussian prior
    advances monotonically by ``delta`` and a confidence gate limits the
    residual to at most ``strength``. All state remains on device so the
    decode loop does not synchronize CUDA once per frame.
    """

    if not settings.use_text_acoustic_bridge:
        return None
    if text_memory.dim() == 3 and text_memory.shape[0] == 1:
        text_memory = text_memory[0]
    if text_memory.dim() != 2 or text_memory.shape[0] <= 0:
        return None
    hidden = int(text_memory.shape[-1])
    compute_dtype = torch.float32
    q = query.reshape(-1, query.shape[-1])[-1:].to(dtype=compute_dtype)
    memory = text_memory.to(dtype=compute_dtype)
    if q.shape[-1] != hidden:
        return None
    q = torch.nan_to_num(q)
    memory = torch.nan_to_num(memory)

    eps = float(settings.eps)
    q_norm = F.normalize(q, dim=-1, eps=eps)
    k_norm = F.normalize(memory, dim=-1, eps=eps)
    positions = torch.arange(memory.shape[0], device=memory.device, dtype=compute_dtype)
    if previous_center is None:
        old_center = positions.new_tensor(0.0)
    else:
        old_center = previous_center.to(device=memory.device, dtype=compute_dtype)
    causal_history = int(settings.text_acoustic_bridge_causal_history)
    if causal_history >= 0:
        current_index = (
            int(current_text_index)
            if current_text_index is not None
            else int(memory.shape[0] - 1)
        )
        current_index = min(max(current_index, 0), int(memory.shape[0] - 1))
        prior_center = positions.new_tensor(float(current_index))
    else:
        return None
    distance = positions - prior_center
    sigma = max(float(settings.text_acoustic_bridge_sigma), eps)
    content_logits = float(settings.text_acoustic_bridge_content_scale) * torch.matmul(
        q_norm, k_norm.transpose(0, 1)
    ).reshape(-1)
    position_logits = -distance.square() / (2.0 * sigma * sigma)
    logits = content_logits + position_logits
    window = int(settings.text_acoustic_bridge_window)
    budgeted_weights = None
    if causal_history >= 0 and current_index is not None:
        future_mask = positions > float(current_index)
        old_mask = positions < float(current_index - causal_history)
        position_bias = settings.text_acoustic_bridge_position_bias
        if position_bias:
            bias = positions.new_tensor(position_bias)
            distance_bucket = (float(current_index) - positions).clamp_min(0.0).long()
            distance_bucket = distance_bucket.clamp_max(int(bias.numel() - 1))
            logits = content_logits + bias[distance_bucket]
            causal_mask = future_mask
            support = max(1, current_index + 1)
        else:
            causal_mask = future_mask | old_mask
            support = max(
                1,
                min(int(memory.shape[0]), causal_history + 1, current_index + 1),
            )
        logits = logits.masked_fill(causal_mask, float("-inf"))
    else:
        if window > 0 and memory.shape[0] > 1:
            logits = logits.masked_fill(distance.abs() > float(window), float("-inf"))
        support = max(
            1,
            min(
                int(memory.shape[0]),
                2 * window + 1 if window > 0 else int(memory.shape[0]),
            ),
        )
    weights = (
        budgeted_weights
        if budgeted_weights is not None
        else torch.softmax(torch.nan_to_num(logits, neginf=-1e4), dim=0)
    )

    context = torch.matmul(weights.unsqueeze(0), memory).unsqueeze(0)
    expected = torch.sum(weights * positions)
    new_center = torch.maximum(old_center, expected).clamp(
        max=float(memory.shape[0] - 1)
    )
    if support <= 1:
        confidence = weights.new_tensor(1.0)
    else:
        entropy = -(weights.clamp_min(eps) * weights.clamp_min(eps).log()).sum()
        confidence = (1.0 - entropy / math.log(support)).clamp(0.0, 1.0)
    strength = float(settings.text_acoustic_bridge_strength)
    gate = strength * (0.5 + 0.5 * confidence)
    return TextAcousticBridgeOutput(
        context=context,
        gate=gate,
        center=new_center,
        confidence=confidence,
    )


@dataclass
class SegmentSnapshot:
    """The two state paths of one healthy predecessor."""

    segment_idx: int
    text_token_ids: list[int]
    c2w_kv: Optional[torch.Tensor] = None
    c2w_conv: Optional[list[torch.Tensor]] = None
    c2w_transconv: Optional[list[torch.Tensor]] = None
    c2w_frame_idx: int = 0
    acoustic_text_tail: Optional[torch.Tensor] = None  # [T_tail, H]

    def clone_owned(self) -> "SegmentSnapshot":
        """Return a tensor-independent copy suitable for a branch session."""

        def clone(value: Optional[torch.Tensor]) -> Optional[torch.Tensor]:
            return value.detach().clone() if value is not None else None

        return SegmentSnapshot(
            segment_idx=self.segment_idx,
            text_token_ids=list(self.text_token_ids),
            c2w_kv=clone(self.c2w_kv),
            c2w_conv=(
                [item.detach().clone() for item in self.c2w_conv]
                if self.c2w_conv is not None
                else None
            ),
            c2w_transconv=(
                [item.detach().clone() for item in self.c2w_transconv]
                if self.c2w_transconv is not None
                else None
            ),
            c2w_frame_idx=self.c2w_frame_idx,
            acoustic_text_tail=clone(self.acoustic_text_tail),
        )


@dataclass
class ContinuationContext:
    """Complete Code2Wav state handed to the successor segment."""

    c2w_kv: Optional[torch.Tensor] = None
    c2w_conv: Optional[list[torch.Tensor]] = None
    c2w_transconv: Optional[list[torch.Tensor]] = None
    c2w_frame_idx: int = 0
    source_segments: list[int] = field(default_factory=list)


class CausalSpeechStateInheritance:
    """Per-session inheritance state machine."""

    def __init__(self, config: SpeechStateInheritanceConfig):
        self.config = config
        self._snapshots: deque[SegmentSnapshot] = deque(
            maxlen=max(1, config.max_ctx_segments)
        )
        self.last_finalized: int = -1
        self._hidden_tails: dict[int, list[tuple[int, torch.Tensor]]] = {}

    # -- segment finalization -------------------------------------------------

    def finalize_segment(
        self,
        segment_idx: int,
        text_token_ids: list[int],
        *,
        eos_reason: str,
        audio_steps: int,
        state=None,
        input_complete: bool = True,
        consumed_text_tokens: Optional[int] = None,
    ) -> bool:
        """Fold the finished segment into continuity state.

        Only a clean, completely consumed, codec-EOS-terminated predecessor
        with an in-range acoustic:text ratio can publish either state path.
        Failure clears the chain so the successor starts from the baseline
        state.

        Returns True when the segment passed the health gate and became
        context; False when the chain was broken (next segment starts fresh).
        """
        self.last_finalized = max(self.last_finalized, segment_idx)
        healthy, reason_key, reason = self._health(
            eos_reason,
            audio_steps,
            len(text_token_ids),
            input_complete=input_complete,
            consumed_text_tokens=consumed_text_tokens,
        )
        if not healthy:
            self._snapshots.clear()
            CONTINUITY_STATS.on_chain_broken(reason_key)
            logger.info(
                "Continuity chain broken at seg=%d (%s); next segment starts fresh",
                segment_idx,
                reason,
            )
            return False

        snap = SegmentSnapshot(
            segment_idx=segment_idx,
            text_token_ids=list(text_token_ids),
        )
        acoustic_tail = (
            int(self.config.text_acoustic_bridge_acoustic_tail)
            if self.config.use_text_acoustic_bridge
            else 0
        )
        hidden_tail = self._hidden_tails.pop(segment_idx, None)
        if acoustic_tail > 0 and hidden_tail:
            snap.acoustic_text_tail = (
                torch.cat([item[1] for item in hidden_tail[-acoustic_tail:]], dim=0)
                .detach()
                .clone()
            )
        if self.config.carry_c2w:
            if state is None or not self._snapshot_c2w(snap, state):
                # Both state paths are one atomic method. Never publish the
                # acoustic hidden tail with an incomplete Code2Wav bundle.
                self._snapshots.clear()
                CONTINUITY_STATS.on_chain_broken("c2w_snapshot_failed")
                logger.warning(
                    "Continuity chain broken at seg=%d "
                    "(incomplete Code2Wav snapshot); next segment starts fresh",
                    segment_idx,
                )
                return False
        self._snapshots.append(snap)
        CONTINUITY_STATS.carried_ok += 1
        return True

    def _health(
        self,
        eos_reason: str,
        audio_steps: int,
        n_text_tokens: int,
        *,
        input_complete: bool = True,
        consumed_text_tokens: Optional[int] = None,
    ) -> tuple[bool, str, str]:
        """Health gate: returns (healthy, reason_key, reason_detail).

        ``reason_key`` is the stable category used for counters;
        ``reason_detail`` carries the value for logs.
        """
        s = self.config
        if not input_complete:
            return False, "input_incomplete", "input_complete=false"
        if n_text_tokens <= 0:
            return False, "no_text_tokens", "no_text_tokens"
        if (
            consumed_text_tokens is not None
            and int(consumed_text_tokens) < n_text_tokens
        ):
            return (
                False,
                "text_unconsumed",
                f"text_unconsumed({int(consumed_text_tokens)}/{n_text_tokens})",
            )
        if s.require_codec_eos and eos_reason != "codec_eos":
            return False, "eos_reason", f"eos_reason={eos_reason}"
        ratio = audio_steps / n_text_tokens
        if not (s.min_ratio <= ratio <= s.max_ratio):
            return False, "ratio_outlier", f"ratio_outlier({ratio:.2f})"
        return True, "", ""

    def _snapshot_c2w(self, snap: SegmentSnapshot, state) -> bool:
        """Own an engine-captured Code2Wav state before slot release."""
        try:
            if getattr(state, "c2w_kv", None) is not None:
                snap.c2w_kv = state.c2w_kv.detach().clone()
            conv = getattr(state, "c2w_conv_states", None)
            if conv is not None:
                snap.c2w_conv = [t.detach().clone() for t in conv]
            transconv = getattr(state, "c2w_transconv_states", None)
            if transconv is not None:
                snap.c2w_transconv = [t.detach().clone() for t in transconv]
            snap.c2w_frame_idx = int(getattr(state, "frame_idx", 0))
            complete = (
                snap.c2w_kv is not None
                and snap.c2w_conv is not None
                and len(snap.c2w_conv) > 0
                and snap.c2w_transconv is not None
                and len(snap.c2w_transconv) > 0
            )
            if not complete:
                snap.c2w_kv = None
                snap.c2w_conv = None
                snap.c2w_transconv = None
                snap.c2w_frame_idx = 0
            return complete
        except Exception:
            logger.warning("C2W snapshot failed; carry-over skipped", exc_info=True)
            snap.c2w_kv = None
            snap.c2w_conv = None
            snap.c2w_transconv = None
            snap.c2w_frame_idx = 0
            return False

    # -- admission-side queries -----------------------------------------------

    def ready_to_admit(self, segment_idx: int) -> bool:
        """Sequential gate: segment N waits until N-1 has finalized."""
        if segment_idx <= 0:
            return True
        return self.last_finalized >= segment_idx - 1

    def context_for(
        self,
        segment_idx: int,
        cur_text_len: Optional[int] = None,
        input_complete: bool = True,
    ) -> Optional[ContinuationContext]:
        """Return only the healthy immediate predecessor's Code2Wav state."""

        del cur_text_len, input_complete
        if self._snapshots:
            newest = self._snapshots[-1]
            if (
                newest.segment_idx == segment_idx - 1
                and self.config.carry_c2w
                and newest.c2w_kv is not None
            ):
                return ContinuationContext(
                    c2w_kv=newest.c2w_kv,
                    c2w_conv=newest.c2w_conv,
                    c2w_transconv=newest.c2w_transconv,
                    c2w_frame_idx=newest.c2w_frame_idx,
                    source_segments=[newest.segment_idx],
                )
        return None

    def should_wait_for_text(
        self,
        segment_idx: int,
        cur_text_len: int,
        input_complete: bool,
    ) -> bool:
        """The strict-causal bridge never waits for unseen target text."""

        del segment_idx, cur_text_len, input_complete
        return False

    def text_tail_for(self, segment_idx: int, max_tokens: int) -> list[int]:
        """Return a healthy immediate predecessor's final text tokens."""

        if max_tokens <= 0:
            return []
        newest = next(
            (
                snapshot
                for snapshot in reversed(self._snapshots)
                if snapshot.segment_idx == segment_idx - 1
            ),
            None,
        )
        if newest is None:
            return []
        return list(newest.text_token_ids[-max_tokens:])

    def acoustic_tail_for(
        self,
        segment_idx: int,
        max_tokens: int,
    ) -> Optional[torch.Tensor]:
        """Return token-aligned Talker hidden states from the predecessor."""

        if max_tokens <= 0:
            return None
        newest = next(
            (
                snapshot
                for snapshot in reversed(self._snapshots)
                if snapshot.segment_idx == segment_idx - 1
            ),
            None,
        )
        if newest is None or newest.acoustic_text_tail is None:
            return None
        return newest.acoustic_text_tail[-max_tokens:]

    def observe_hidden(
        self,
        segment_idx: int,
        text_index: int,
        hidden: torch.Tensor,
    ) -> None:
        """Retain only H token-aligned acoustic hidden states for finalization."""

        limit = int(self.config.text_acoustic_bridge_acoustic_tail)
        if limit <= 0 or hidden.numel() == 0:
            return
        item = hidden.detach().reshape(1, -1).clone()
        tail = self._hidden_tails.setdefault(segment_idx, [])
        if tail and tail[-1][0] == int(text_index):
            tail[-1] = (int(text_index), item)
        else:
            tail.append((int(text_index), item))
            del tail[:-limit]

    def prepare_bridge(
        self,
        segment_idx: int,
        current_text_memory: torch.Tensor,
    ) -> Optional[TextAcousticBridgeState]:
        """Build opaque bridge memory for a healthy immediate successor."""

        if not self.config.use_text_acoustic_bridge or segment_idx <= 0:
            return None
        acoustic = self.acoustic_tail_for(
            segment_idx,
            self.config.text_acoustic_bridge_acoustic_tail,
        )
        if acoustic is None or acoustic.numel() == 0:
            return None
        memory = current_text_memory
        if memory.dim() == 3 and memory.shape[0] == 1:
            memory = memory[0]
        if memory.dim() != 2 or memory.shape[0] <= 0:
            return None
        acoustic = acoustic.to(device=memory.device, dtype=memory.dtype)
        joined = torch.cat([acoustic, memory], dim=0).detach().clone()
        return TextAcousticBridgeState(
            memory=joined,
            acoustic_history_len=int(acoustic.shape[0]),
            center=joined.new_tensor(0.0, dtype=torch.float32),
        )

    def apply_bridge(
        self,
        state: Optional[TextAcousticBridgeState],
        *,
        query: Optional[torch.Tensor],
        base: torch.Tensor,
        current_text_index: int,
    ) -> torch.Tensor:
        """Apply one bounded causal residual to an engine-provided base input."""

        if state is None:
            return base.to(torch.float32)
        if query is None and state.acoustic_history_len > 0:
            query = state.memory[
                state.acoustic_history_len - 1 : state.acoustic_history_len
            ].reshape(1, 1, -1)
        if query is None:
            return base.to(torch.float32)
        arrived_index = min(
            max(state.acoustic_history_len + int(current_text_index), 0),
            int(state.memory.shape[0] - 1),
        )
        result = build_text_acoustic_bridge(
            query=query,
            text_memory=state.memory,
            previous_center=state.center,
            settings=self.config,
            current_text_index=arrived_index,
        )
        if result is None:
            return base.to(torch.float32)
        state.center = result.center.detach()
        state.updates += 1
        residual = result.context.to(device=base.device, dtype=base.dtype)
        return (base + result.gate.to(base.dtype) * residual).to(torch.float32)

    # -- lifecycle -------------------------------------------------------------

    def invalidate(self, reason: str = "") -> None:
        """Break the chain (cancel / replace / error paths)."""
        self._snapshots.clear()
        self._hidden_tails.clear()
        CONTINUITY_STATS.invalidated += 1
        if reason:
            logger.info("Continuity invalidated: %s", reason)

    def reset_segment_capture(self, segment_idx: int) -> None:
        """Discard one failed attempt without finalizing its segment.

        Upstream may reseed and rerun a lookahead segment before any of its
        audio becomes visible. Hidden states from that abandoned attempt must
        not leak into the replacement attempt, while ``last_finalized`` must
        remain unchanged so the strict predecessor gate stays closed.
        """

        self._hidden_tails.pop(segment_idx, None)

    def drop_segment(self, segment_idx: int) -> None:
        """Forget capture state of a segment that will never finalize."""
        self.last_finalized = max(self.last_finalized, segment_idx)
        self._hidden_tails.pop(segment_idx, None)
