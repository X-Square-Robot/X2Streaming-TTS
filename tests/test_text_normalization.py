from __future__ import annotations

import pytest

from x2streaming_tts.commitment.text_normalization import (
    split_pending_emoji,
    strip_emoji,
)


@pytest.mark.unit
def test_strip_emoji_preserves_surrounding_words() -> None:
    assert strip_emoji("hello🙂world") == "hello world"
    assert strip_emoji("你好🙂世界") == "你好世界"


@pytest.mark.unit
def test_keycap_prefix_is_held_across_packet_boundary() -> None:
    assert split_pending_emoji("编号1") == ("编号", "1")
    assert strip_emoji("1️⃣") == ""


@pytest.mark.unit
def test_complete_plain_text_is_not_held() -> None:
    assert split_pending_emoji("正常文本。") == ("正常文本。", "")
