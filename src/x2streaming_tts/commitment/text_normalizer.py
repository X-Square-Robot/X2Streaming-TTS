"""Text-normalization adapters used by the streaming frontend.

The engine owns one process-wide WeTextProcessing graph.  Per-session rule
frontends receive the same adapter, avoiding an expensive FST load for every
request while keeping the third-party import outside pure segmentation tests.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import Protocol


class TextNormalizer(Protocol):
    """Minimal adapter contract accepted by :class:`RuleBoundaryFrontend`."""

    def normalize(self, text: str) -> str:
        """Return a speakable normalization of ``text``."""


class TextNormalizationError(RuntimeError):
    """Raised when an enabled text normalizer cannot produce usable output."""


class WeTextChineseNormalizer:
    """Process-safe wrapper around WeTextProcessing's Chinese TN graph."""

    def __init__(self) -> None:
        try:
            from tn.chinese.normalizer import Normalizer as ZhNormalizer
        except ImportError as exc:
            raise TextNormalizationError(
                "WeTextProcessing is required when "
                "spliter.text_normalization_enabled=true; install "
                "WeTextProcessing==1.2.0"
            ) from exc

        try:
            # Reuse the package's pre-composed FAR rather than rebuilding rules
            # inside every serving container.
            self._normalizer = ZhNormalizer(overwrite_cache=False)
        except Exception as exc:
            raise TextNormalizationError(
                "failed to initialize the WeTextProcessing Chinese normalizer"
            ) from exc
        self._lock = threading.Lock()

    def normalize(self, text: str) -> str:
        source = str(text or "")
        if not source:
            return ""
        try:
            # Pynini/FST traversal is kept behind a lock because sessions share
            # this object and transport callbacks may execute concurrently.
            with self._lock:
                normalized = str(self._normalizer.normalize(source) or "").strip()
        except Exception as exc:
            raise TextNormalizationError(
                f"WeTextProcessing failed to normalize {source!r}"
            ) from exc
        if not normalized:
            raise TextNormalizationError(
                f"WeTextProcessing returned empty text for {source!r}"
            )
        return normalized


@lru_cache(maxsize=1)
def get_wetext_chinese_normalizer() -> WeTextChineseNormalizer:
    """Return the single WeTextProcessing graph used by this engine process."""

    return WeTextChineseNormalizer()


__all__ = (
    "TextNormalizer",
    "TextNormalizationError",
    "WeTextChineseNormalizer",
    "get_wetext_chinese_normalizer",
)
