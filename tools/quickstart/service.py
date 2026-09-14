"""Validate real Realtime audio before reporting an endpoint as ready."""

from __future__ import annotations

import asyncio
import base64
import json
import uuid
from urllib.parse import urlsplit, urlunsplit

from aiohttp import ClientSession, ClientTimeout, WSMsgType

REQUIRED_EXTENSIONS = {
    "qwen.input_text_buffer.v1",
    "qwen.text_progress.v1",
    "qwen.playback_ack.v1",
    "qwen.response_resume.v1",
}


def validate_capabilities(caps):
    protocol = caps.get("protocols", {}).get("openai_realtime", {})
    if caps.get("schema_version") != "qwen.tts.capabilities.v1":
        raise ValueError("Unsupported capabilities schema")
    if not REQUIRED_EXTENSIONS.issubset(protocol.get("supported_extensions", [])):
        raise ValueError("Engine lacks the Demo's required Realtime extensions")
    if "custom_voice" not in caps.get(
        "tasks", []
    ) or "robot_service_v1" not in caps.get("speakers", []):
        raise ValueError(
            "The expected robot_service_v1 CustomVoice model is not loaded"
        )
    if "full_text" not in caps.get("input_modes", []):
        raise ValueError("Full-text input is unavailable")
    audio = next(
        (
            item
            for item in caps.get("audio_formats", [])
            if item.get("encoding") == "pcm_s16le" and item.get("channels") == 1
        ),
        None,
    )
    if not audio or "pcm_s16le" not in protocol.get("audio_formats", []):
        raise ValueError("PCM16 playback is unavailable")
    return audio


def websocket_url(base: str) -> str:
    parsed = urlsplit(base)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Expected a plain HTTP(S) service URL")
    return urlunsplit(
        (
            "wss" if parsed.scheme == "https" else "ws",
            parsed.netloc,
            parsed.path.rstrip("/") + "/v1/realtime",
            "",
            "",
        )
    )


async def probe(base: str, *, synthesize: bool = True, origin: str | None = None):
    headers = {"Origin": origin} if origin else {}
    async with ClientSession(timeout=ClientTimeout(total=90)) as client:
        async with client.get(base + "/v1/capabilities", headers=headers) as response:
            response.raise_for_status()
            if origin and response.headers.get("Access-Control-Allow-Origin") not in {
                origin,
                "*",
            }:
                raise ValueError("The Demo origin is not allowed by CORS")
            caps = await response.json()
        audio = validate_capabilities(caps)
        async with client.ws_connect(websocket_url(base), headers=headers) as ws:
            received = 0
            resume_token = str(uuid.uuid4())
            async with asyncio.timeout(75):
                async for message in ws:
                    if message.type != WSMsgType.TEXT:
                        raise RuntimeError(
                            "Realtime disconnected before a successful response"
                        )
                    event = json.loads(message.data)
                    kind = event.get("type")
                    if kind == "error":
                        raise RuntimeError(str(event.get("error", "Realtime error")))
                    if kind == "session.created":
                        if not synthesize:
                            return caps
                        await ws.send_json(
                            {
                                "type": "session.update",
                                "session": {
                                    "type": "realtime",
                                    "model": caps.get("model", ""),
                                    "output_modalities": ["audio"],
                                    "audio": {
                                        "output": {
                                            "format": {
                                                "type": "audio/pcm",
                                                "rate": audio["sample_rate"],
                                            },
                                            "voice": "robot_service_v1",
                                        }
                                    },
                                    "qwen": {
                                        "task_type": "custom_voice",
                                        "speaker": "robot_service_v1",
                                        "language": "Chinese",
                                        "input_mode": "full_text",
                                        "output_policy": {
                                            "vad_policy": {
                                                "enabled": False,
                                                "strategy": "disabled",
                                            },
                                            "emit_text_events": True,
                                            "config": {"delivery": "guarded"},
                                        },
                                    },
                                },
                            }
                        )
                    elif kind == "session.updated":
                        await ws.send_json(
                            {
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "input_text",
                                            "text": "你好，语音服务已经准备好了。",
                                        }
                                    ],
                                },
                            }
                        )
                        await ws.send_json(
                            {
                                "type": "response.create",
                                "response": {
                                    "metadata": {"qwen_resume_token": resume_token}
                                },
                            }
                        )
                    elif kind == "response.output_audio.delta":
                        raw = base64.b64decode(event.get("delta", ""), validate=True)
                        start, end = (
                            int(event["qwen_output_sample_start"]),
                            int(event["qwen_output_sample_end"]),
                        )
                        if (
                            len(raw) % 2
                            or start != received
                            or end != start + len(raw) // 2
                        ):
                            raise ValueError("Invalid/non-contiguous PCM audio")
                        received = end
                    elif kind == "response.done":
                        if (
                            event.get("response", {}).get("status") != "completed"
                            or not received
                        ):
                            raise RuntimeError(
                                "The engine did not produce a successful audio result"
                            )
                        await ws.send_json(
                            {
                                "type": "qwen.response.terminal_ack",
                                "resume_token": resume_token,
                                "through_delivery_seq": event.get(
                                    "qwen_delivery_seq", 0
                                ),
                                "audio_through_sample": str(received),
                            }
                        )
                        return caps
            raise RuntimeError("Realtime closed without a completed response")
