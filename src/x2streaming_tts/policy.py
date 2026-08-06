"""Public facade for the unified X2Streaming-TTS method."""

from __future__ import annotations

from .commitment.policy import CausalCommitment
from .commitment.text_normalizer import TextNormalizer
from .config import X2StreamingConfig


class X2StreamingPolicy:
    """Construct the two mechanisms described by the X2Streaming-TTS paper."""

    def __init__(
        self,
        config: X2StreamingConfig | None = None,
        *,
        text_normalizer: TextNormalizer,
    ) -> None:
        self.config = config or X2StreamingConfig()
        self.text_normalizer = text_normalizer

    def new_causal_commitment(self) -> CausalCommitment:
        config = self.config
        return CausalCommitment(
            capacity=config.capacity,
            rules=config.boundary_rules,
            text_normalizer=self.text_normalizer,
            normalize_special_spans=config.normalize_special_spans,
            symbol_only_boundary_mode=config.symbol_only_boundary_mode,
        )

    def new_speech_state_inheritance(self):
        # Torch remains an optional dependency until the acoustic mechanism is
        # actually constructed.
        from .inheritance.speech_state_inheritance import (
            CausalSpeechStateInheritance,
        )

        return CausalSpeechStateInheritance(self.config.inheritance)
