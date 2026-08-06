from __future__ import annotations

from pathlib import Path

import pytest

from x2streaming_tts.adapters.qwen3tts_streaming.compatibility import (
    inspect_upstream,
    require_compatible_upstream,
)

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.integration
def test_checked_out_upstream_matches_lock() -> None:
    result = inspect_upstream(ROOT)

    assert result.compatible
    assert result.actual_commit == "0745e4a8613f0780cc57475452ee775a9abac2dd"
    assert require_compatible_upstream(ROOT) == result.checkout
