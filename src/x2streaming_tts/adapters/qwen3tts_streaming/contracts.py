"""Structural contracts implemented by X2's session-scoped policies.

The patched upstream engine uses duck typing, so importing this module is not
required at runtime. These protocols document the exact callback surface and
keep engine-owned mutable slots out of the X2 package boundary.
"""

from __future__ import annotations

from typing import Any, Protocol, Sequence


class CommittedSpan(Protocol):
    text: str
    boundary_before: bool
    rule_name: str


class CommitmentPolicy(Protocol):
    def feed_text(
        self, text: str, *, final: bool = False
    ) -> Sequence[CommittedSpan]: ...

    def splitter_config(self) -> dict[str, int | float]: ...

    def split_thresholds(self) -> Any: ...

    def observe_segment(
        self,
        *,
        audio_steps: int,
        text_tokens: int,
        overflow: bool = False,
    ) -> float: ...

    def reset(self) -> None: ...


class ContinuityPolicy(Protocol):
    def ready_to_admit(self, segment_idx: int) -> bool: ...

    def should_wait_for_text(
        self,
        segment_idx: int,
        cur_text_len: int,
        input_complete: bool,
    ) -> bool: ...

    def context_for(
        self,
        segment_idx: int,
        cur_text_len: int | None = None,
        input_complete: bool = True,
    ) -> Any: ...

    def observe_hidden(
        self,
        segment_idx: int,
        text_index: int,
        hidden: Any,
    ) -> None: ...

    def prepare_bridge(self, segment_idx: int, current_text_memory: Any) -> Any: ...

    def apply_bridge(
        self,
        state: Any,
        *,
        query: Any,
        base: Any,
        current_text_index: int,
    ) -> Any: ...

    def finalize_segment(
        self,
        segment_idx: int,
        text_token_ids: list[int],
        *,
        eos_reason: str,
        audio_steps: int,
        state: Any,
        input_complete: bool,
        consumed_text_tokens: int,
    ) -> bool: ...

    def reset_segment_capture(self, segment_idx: int) -> None: ...

    def invalidate(self, reason: str = "") -> None: ...
