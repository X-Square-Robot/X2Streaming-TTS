from types import SimpleNamespace

import torch

from x2streaming_tts import SpeechStateInheritanceConfig
from x2streaming_tts.inheritance.speech_state_inheritance import (
    CausalSpeechStateInheritance,
)


def _slot() -> SimpleNamespace:
    return SimpleNamespace(
        c2w_kv=torch.tensor([[[[1.0, 2.0]]]]),
        c2w_conv_states=[torch.tensor([[[3.0]]])],
        c2w_transconv_states=[torch.tensor([[[4.0]]])],
        frame_idx=7,
        text_acoustic_hidden_tail=[],
    )


def _finalize_healthy(
    continuity: CausalSpeechStateInheritance,
    segment_idx: int,
    slot: SimpleNamespace,
) -> bool:
    return continuity.finalize_segment(
        segment_idx,
        [10, 11],
        eos_reason="codec_eos",
        audio_steps=4,
        state=slot,
        input_complete=True,
        consumed_text_tokens=2,
    )


def test_successor_waits_for_immediate_predecessor() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    assert continuity.ready_to_admit(0)
    assert not continuity.ready_to_admit(1)

    assert _finalize_healthy(continuity, 0, _slot())
    assert continuity.ready_to_admit(1)


def test_method_carries_complete_c2w_bundle_and_owns_snapshot() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    slot = _slot()

    assert _finalize_healthy(continuity, 0, slot)
    context = continuity.context_for(1)
    assert context is not None
    assert context.source_segments == [0]
    assert context.c2w_frame_idx == 7
    assert torch.equal(context.c2w_kv, torch.tensor([[[[1.0, 2.0]]]]))

    slot.c2w_kv.zero_()
    slot.c2w_conv_states[0].zero_()
    slot.c2w_transconv_states[0].zero_()
    assert torch.equal(context.c2w_kv, torch.tensor([[[[1.0, 2.0]]]]))
    assert context.c2w_conv[0].item() == 3.0
    assert context.c2w_transconv[0].item() == 4.0


def test_unhealthy_finalize_breaks_existing_chain() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    assert _finalize_healthy(continuity, 0, _slot())
    assert continuity.context_for(1) is not None

    assert not continuity.finalize_segment(
        1,
        [12],
        eos_reason="cancelled",
        audio_steps=2,
        state=_slot(),
        input_complete=True,
        consumed_text_tokens=1,
    )
    assert continuity.context_for(2) is None


def test_incomplete_c2w_snapshot_fails_closed() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    incomplete_slot = SimpleNamespace(
        c2w_kv=torch.ones(1),
        c2w_conv_states=[],
        c2w_transconv_states=[],
        frame_idx=1,
        text_acoustic_hidden_tail=[],
    )

    assert not _finalize_healthy(continuity, 0, incomplete_slot)
    assert continuity.context_for(1) is None


def test_explicit_invalidation_clears_context() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    assert _finalize_healthy(continuity, 0, _slot())

    continuity.invalidate("replacement")
    assert continuity.context_for(1) is None


def test_only_final_four_acoustic_hidden_states_are_owned() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    slot = _slot()
    hidden = [torch.tensor([[[float(index), float(index + 10)]]]) for index in range(6)]
    for index, item in enumerate(hidden):
        continuity.observe_hidden(0, index, item)

    assert _finalize_healthy(continuity, 0, slot)
    tail = continuity.acoustic_tail_for(1, 10)
    assert tail is not None
    torch.testing.assert_close(
        tail,
        torch.tensor([[2.0, 12.0], [3.0, 13.0], [4.0, 14.0], [5.0, 15.0]]),
    )

    hidden[-1].zero_()
    assert tail[-1].tolist() == [5.0, 15.0]


def test_bridge_state_is_prepared_and_updated_by_public_lifecycle() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    continuity.observe_hidden(0, 0, torch.ones(1, 1, 2))
    continuity.observe_hidden(0, 1, torch.full((1, 1, 2), 2.0))
    assert _finalize_healthy(continuity, 0, _slot())

    state = continuity.prepare_bridge(1, torch.randn(3, 2))
    assert state is not None
    assert state.acoustic_history_len == 2
    base = torch.randn(1, 1, 2)
    updated = continuity.apply_bridge(
        state,
        query=None,
        base=base,
        current_text_index=0,
    )
    assert updated.dtype == torch.float32
    assert state.updates == 1
    assert not torch.equal(updated, base)


def test_retry_reset_discards_attempt_capture_without_opening_gate() -> None:
    continuity = CausalSpeechStateInheritance(SpeechStateInheritanceConfig())
    continuity.observe_hidden(0, 0, torch.ones(1, 1, 8))

    continuity.reset_segment_capture(0)

    assert continuity._hidden_tails == {}
    assert continuity.last_finalized == -1
    assert not continuity.ready_to_admit(1)
