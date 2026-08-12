"""Public configuration for the X2Streaming-TTS method."""

from __future__ import annotations

from dataclasses import dataclass, field

from .commitment.capacity import CapacityConfig


@dataclass(frozen=True)
class SpeechStateInheritanceConfig:
    """The single inheritance configuration for the method."""

    enabled: bool = True
    max_ctx_frames: int = 160
    max_ctx_text_tokens: int = 192
    max_ctx_segments: int = 2
    min_ratio: float = 1.0
    max_ratio: float = 12.0
    require_codec_eos: bool = True
    stream_wait_ms: int = 1500
    eps: float = 1e-6
    text_acoustic_bridge_strength: float = 0.015
    text_acoustic_bridge_sigma: float = 2.0
    text_acoustic_bridge_window: int = 8
    text_acoustic_bridge_content_scale: float = 2.0
    text_acoustic_bridge_acoustic_tail: int = 4

    @property
    def carry_c2w(self) -> bool:
        return self.enabled

    @property
    def use_text_acoustic_bridge(self) -> bool:
        return self.enabled

    @property
    def strict_token_streaming(self) -> bool:
        return self.enabled

    @property
    def text_acoustic_bridge_causal_history(self) -> int:
        return 4 if self.enabled else -1

    @property
    def text_acoustic_bridge_position_bias(self) -> tuple[float, ...]:
        return (0.0, -0.125, -0.5, -1.125, -2.0, -2.302585093)


@dataclass(frozen=True)
class X2StreamingConfig:
    """Configuration of the unified X2Streaming-TTS method."""

    capacity: CapacityConfig = field(default_factory=CapacityConfig)
    inheritance: SpeechStateInheritanceConfig = field(
        default_factory=SpeechStateInheritanceConfig
    )
    boundary_rules: tuple[str, ...] = ("special_text",)
    normalize_special_spans: bool = True
    symbol_only_boundary_mode: str = "coalesce"
