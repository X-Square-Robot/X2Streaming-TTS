"""Causal commitment for streaming text."""

from .capacity import (
    AdaptiveCapacityEstimator,
    CapacityConfig,
    CausalCommitmentController,
    CommitmentDecision,
    SplitThresholds,
    compute_thresholds,
)
from .policy import CausalCommitment
from .rule_boundary import RuleBoundaryFrontend, RuleBoundarySpan
from .text_normalization import is_emoji_char, split_pending_emoji, strip_emoji
from .text_normalizer import TextNormalizer

__all__ = (
    "AdaptiveCapacityEstimator",
    "CapacityConfig",
    "CausalCommitment",
    "CausalCommitmentController",
    "CommitmentDecision",
    "RuleBoundaryFrontend",
    "RuleBoundarySpan",
    "SplitThresholds",
    "TextNormalizer",
    "compute_thresholds",
    "is_emoji_char",
    "split_pending_emoji",
    "strip_emoji",
)
