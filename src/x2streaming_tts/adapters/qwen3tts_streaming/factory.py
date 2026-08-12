"""Factories that bind X2 policies to the optional upstream hook surface.

The module deliberately avoids importing ``engine`` at import time.  A caller
first builds the session-scoped factories, then materializes the upstream
``EngineExtensions`` object after applying the pinned hook patch (or after the
same hooks land upstream).
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any, Callable

from ...policy import X2StreamingPolicy


@dataclass(frozen=True)
class PolicyFactoryBundle:
    """Engine-independent representation of the two method mechanisms."""

    commitment_factory: Callable[[str, Any], Any]
    continuity_factory: Callable[[str, Any], Any]

    def to_upstream(self, engine_extensions_type: type | None = None) -> Any:
        """Create the patched/upstream ``EngineExtensions`` value.

        ``engine_extensions_type`` is injectable for tests.  In production it
        is imported lazily so importing X2 itself never mutates ``sys.path`` or
        silently selects an arbitrary upstream checkout.
        """

        if engine_extensions_type is None:
            try:
                module = importlib.import_module("engine.core.extensions")
                engine_extensions_type = module.EngineExtensions
            except (ImportError, AttributeError) as exc:
                raise RuntimeError(
                    "Qwen3TTS-Streaming extension hooks are unavailable; "
                    "initialize the pinned submodule and apply the verified "
                    "patch series in patches/upstream/"
                ) from exc
        return engine_extensions_type(
            commitment_factory=self.commitment_factory,
            continuity_factory=self.continuity_factory,
        )


def build_policy_factories(policy: X2StreamingPolicy) -> PolicyFactoryBundle:
    """Build fresh-policy factories for each upstream streaming session."""

    def commitment_factory(_session_id: str, _session_config: Any) -> Any:
        return policy.new_causal_commitment()

    def continuity_factory(_session_id: str, _session_config: Any) -> Any:
        return policy.new_speech_state_inheritance()

    return PolicyFactoryBundle(
        commitment_factory=commitment_factory,
        continuity_factory=continuity_factory,
    )
