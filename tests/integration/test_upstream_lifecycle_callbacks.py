from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

from x2streaming_tts import X2StreamingPolicy
from x2streaming_tts.adapters.qwen3tts_streaming import build_policy_factories

pytestmark = pytest.mark.integration


class IdentityNormalizer:
    def normalize(self, text: str) -> str:
        return text


class CharTokenizer:
    def encode_ids(self, text: str, add_special_tokens: bool = False) -> list[int]:
        del add_special_tokens
        return [ord(char) for char in text]

    def encode_with_text(
        self,
        text: str,
        add_special_tokens: bool = False,
    ) -> tuple[list[int], list[str]]:
        return self.encode_ids(text, add_special_tokens), list(text)


def _load_patched_upstream() -> None:
    value = os.environ.get("X2_PATCHED_UPSTREAM_ROOT")
    if not value:
        pytest.skip("X2_PATCHED_UPSTREAM_ROOT is not set")
    root = Path(value).resolve()
    sys.path.insert(0, str(root / "client/src"))
    sys.path.insert(0, str(root))


async def _drain(queue: asyncio.Queue) -> list:
    result = []
    while not queue.empty():
        result.append(await queue.get())
    return result


def test_real_frontend_consumes_only_committed_spans_and_opens_boundary() -> None:
    _load_patched_upstream()
    from engine.core.extensions import EngineExtensions
    from engine.core.types import GroupPolicy, InputMode, RequestType, SessionConfig
    from engine.frontend.interface import FrontendInterface

    async def run() -> None:
        inbox: asyncio.Queue = asyncio.Queue()
        policy = X2StreamingPolicy(text_normalizer=IdentityNormalizer())
        extensions = build_policy_factories(policy).to_upstream(EngineExtensions)
        frontend = FrontendInterface(
            inbox,
            CharTokenizer(),
            extensions=extensions,
            max_concurrent_segments=2,
        )
        session = await frontend.create_session(
            "x2-lifecycle",
            config=SessionConfig(
                task_type="custom_voice",
                input_mode=InputMode.TOKEN,
                group_policy=GroupPolicy.NONE,
            ),
        )

        await frontend.push_text_input("x2-lifecycle", "温度25")
        first = await _drain(inbox)
        assert [token for item in first for token in (item.token_ids or [])] == [
            ord("温"),
            ord("度"),
        ]
        assert session.spliter.current_thresholds.force_split_at == 60

        await frontend.push_text_input("x2-lifecycle", "℃。")
        second = await _drain(inbox)
        assert second[0].type is RequestType.SEGMENT_TOKENS_DONE
        assert second[0].segment_idx == 0
        assert second[1].type is RequestType.START_TOKENS
        assert second[1].segment_idx == 1
        assert [token for item in second for token in (item.token_ids or [])] == [
            ord(char) for char in "25℃。"
        ]

        await frontend.cancel_session("x2-lifecycle")

    asyncio.run(run())
