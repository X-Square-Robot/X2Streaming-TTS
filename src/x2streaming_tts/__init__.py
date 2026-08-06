"""X2Streaming-TTS: causal token-level TTS from streaming text."""

from .config import SpeechStateInheritanceConfig, X2StreamingConfig
from .policy import X2StreamingPolicy

__version__ = "0.1.0.dev0"

__all__ = (
    "SpeechStateInheritanceConfig",
    "X2StreamingConfig",
    "X2StreamingPolicy",
    "__version__",
)
