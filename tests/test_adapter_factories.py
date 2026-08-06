from dataclasses import dataclass

import pytest

from x2streaming_tts import X2StreamingPolicy
from x2streaming_tts.adapters.qwen3tts_streaming import build_policy_factories
from x2streaming_tts.commitment import CausalCommitment
from x2streaming_tts.inheritance.speech_state_inheritance import (
    CausalSpeechStateInheritance,
)


@dataclass
class FakeEngineExtensions:
    commitment_factory: object
    continuity_factory: object


class IdentityNormalizer:
    def normalize(self, text: str) -> str:
        return text


def test_factories_are_session_scoped_and_configured() -> None:
    policy = X2StreamingPolicy(text_normalizer=IdentityNormalizer())
    factories = build_policy_factories(policy)
    extension = factories.to_upstream(FakeEngineExtensions)

    commitment_a = extension.commitment_factory("a", object())
    commitment_b = extension.commitment_factory("b", object())
    continuity = extension.continuity_factory("a", object())
    assert isinstance(commitment_a, CausalCommitment)
    assert isinstance(commitment_b, CausalCommitment)
    assert commitment_a is not commitment_b
    assert isinstance(continuity, CausalSpeechStateInheritance)
    assert continuity.config.text_acoustic_bridge_acoustic_tail == 4


def test_missing_upstream_hooks_has_actionable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    factories = build_policy_factories(
        X2StreamingPolicy(text_normalizer=IdentityNormalizer())
    )

    def fail_import(_name: str) -> object:
        raise ImportError("missing")

    monkeypatch.setattr(
        "x2streaming_tts.adapters.qwen3tts_streaming.factory.importlib.import_module",
        fail_import,
    )
    with pytest.raises(RuntimeError, match="apply the verified patch series"):
        factories.to_upstream()
