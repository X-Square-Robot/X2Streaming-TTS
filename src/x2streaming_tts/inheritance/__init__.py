"""Causal speech-state inheritance.

Torch-backed implementations are imported explicitly from
``speech_state_inheritance`` so importing the top-level package does not
require a GPU stack.
"""

from ..config import SpeechStateInheritanceConfig

__all__ = ("SpeechStateInheritanceConfig",)
