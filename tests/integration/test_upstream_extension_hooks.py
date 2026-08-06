from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from x2streaming_tts import X2StreamingPolicy
from x2streaming_tts.adapters.qwen3tts_streaming import build_policy_factories
from x2streaming_tts.commitment import CausalCommitment
from x2streaming_tts.inheritance.speech_state_inheritance import (
    CausalSpeechStateInheritance,
)

pytestmark = pytest.mark.integration


class IdentityNormalizer:
    def normalize(self, text: str) -> str:
        return text


def _patched_upstream() -> Path:
    value = os.environ.get("X2_PATCHED_UPSTREAM_ROOT")
    if not value:
        pytest.skip("X2_PATCHED_UPSTREAM_ROOT is not set")
    root = Path(value).resolve()
    if not (root / "engine/core/extensions.py").is_file():
        pytest.fail(f"extension hook patch is not applied at {root}")
    sys.path.insert(0, str(root / "client/src"))
    sys.path.insert(0, str(root))
    return root


def test_patched_engine_constructs_only_the_two_paper_mechanisms() -> None:
    _patched_upstream()
    from engine.backend.engine_loop import EngineSessionGroup
    from engine.core.extensions import EngineExtensions

    policy = X2StreamingPolicy(text_normalizer=IdentityNormalizer())
    extensions = build_policy_factories(policy).to_upstream(EngineExtensions)
    request = SimpleNamespace(result_queue=None, session_config=SimpleNamespace())
    group = EngineSessionGroup("integration-session", request, extensions)

    commitment = extensions.commitment_factory("integration-session", object())
    assert isinstance(commitment, CausalCommitment)
    assert isinstance(group.extension_continuity, CausalSpeechStateInheritance)
    assert not hasattr(extensions, "audio_join_factory")
