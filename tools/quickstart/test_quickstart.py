from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from gateway import create_app
from launch import validate_snapshot
from service import REQUIRED_EXTENSIONS, probe, validate_capabilities, websocket_url


def capabilities():
    return {
        "schema_version": "qwen.tts.capabilities.v1",
        "model": "fixture",
        "tasks": ["custom_voice"],
        "speakers": ["robot_service_v1"],
        "input_modes": ["full_text", "token"],
        "audio_formats": [
            {"encoding": "pcm_s16le", "channels": 1, "sample_rate": 24000}
        ],
        "protocols": {
            "openai_realtime": {
                "path": "/v1/realtime",
                "supported_extensions": list(REQUIRED_EXTENSIONS),
                "audio_formats": ["pcm_s16le"],
            }
        },
    }


class ReleaseTests(unittest.TestCase):
    def test_dry_run_makes_no_files(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "not-created"
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("launch.py")),
                    "--dry-run",
                    "--public",
                    "--work-dir",
                    str(target),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertTrue(json.loads(result.stdout)["public"])
            self.assertFalse(target.exists())

    def test_checksum_corruption_and_escape_fail(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            (folder / "model").write_bytes(b"original")
            checksum = hashlib.sha256(b"original").hexdigest()
            (folder / "SHA256SUMS").write_text(f"{checksum}  model\n")
            self.assertEqual(validate_snapshot(folder), {"model": checksum})
            (folder / "model").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                validate_snapshot(folder)
            (folder / "SHA256SUMS").write_text(f"{checksum}  ../escape\n")
            with self.assertRaisesRegex(ValueError, "invalid release file"):
                validate_snapshot(folder)
            (folder / "SHA256SUMS").write_text("")
            with self.assertRaisesRegex(ValueError, "empty"):
                validate_snapshot(folder)

    def test_wrong_voice_and_protocol_are_not_ready(self):
        data = capabilities()
        validate_capabilities(data)
        data["speakers"] = ["other"]
        with self.assertRaisesRegex(ValueError, "robot_service_v1"):
            validate_capabilities(data)
        data = capabilities()
        data["protocols"]["openai_realtime"]["supported_extensions"] = []
        with self.assertRaisesRegex(ValueError, "extensions"):
            validate_capabilities(data)

    def test_websocket_keeps_access_path_and_tls(self):
        self.assertEqual(
            websocket_url("https://demo.example/private"),
            "wss://demo.example/private/v1/realtime",
        )
        with self.assertRaises(ValueError):
            websocket_url("https://demo.example/?token=secret")


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mode = "success"
        self.messages = []
        app = web.Application()

        async def caps(request):
            return web.json_response(capabilities())

        async def realtime(request):
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_json({"type": "session.created", "session": {"id": "test"}})
            async for message in ws:
                event = json.loads(message.data)
                self.messages.append(event)
                if event["type"] == "session.update":
                    await ws.send_json(
                        {"type": "session.updated", "session": {"id": "test"}}
                    )
                if event["type"] == "response.create":
                    if self.mode == "failure":
                        await ws.send_json(
                            {"type": "error", "error": {"message": "fixture failed"}}
                        )
                        continue
                    if self.mode != "empty":
                        await ws.send_json(
                            {
                                "type": "response.output_audio.delta",
                                "delta": base64.b64encode(b"\0\0" * 80).decode(),
                                "qwen_output_sample_start": 1
                                if self.mode == "gap"
                                else 0,
                                "qwen_output_sample_end": 80,
                            }
                        )
                    await ws.send_json(
                        {
                            "type": "response.done",
                            "qwen_delivery_seq": 2,
                            "response": {"id": "test", "status": "completed"},
                        }
                    )
            return ws

        app.router.add_get("/v1/capabilities", caps)
        app.router.add_get("/v1/realtime", realtime)
        self.upstream = TestServer(app)
        await self.upstream.start_server()
        self.gateway = TestServer(
            create_app(
                str(self.upstream.make_url("/")).rstrip("/"),
                "private",
                {"https://demo.example"},
            )
        )
        await self.gateway.start_server()
        self.base = str(self.gateway.make_url("/private"))

    async def asyncTearDown(self):
        await self.gateway.close()
        await self.upstream.close()

    async def test_success_requires_completed_audio(self):
        result = await probe(self.base, origin="https://demo.example")
        self.assertEqual(result["speakers"], ["robot_service_v1"])
        self.assertIn(
            "qwen.response.terminal_ack", [event["type"] for event in self.messages]
        )

    async def test_empty_audio_is_not_success(self):
        self.mode = "empty"
        with self.assertRaisesRegex(RuntimeError, "audio result"):
            await probe(self.base)

    async def test_noncontiguous_audio_is_rejected(self):
        self.mode = "gap"
        with self.assertRaisesRegex(ValueError, "contiguous"):
            await probe(self.base)

    async def test_server_failure_is_not_success(self):
        self.mode = "failure"
        with self.assertRaisesRegex(RuntimeError, "fixture failed"):
            await probe(self.base)

    async def test_gateway_only_exposes_allowed_paths_and_origins(self):
        async with ClientSession() as client:
            for path in [
                "/v1/capabilities",
                "/private/health",
                "/private/demo",
                "/wrong/v1/capabilities",
            ]:
                async with client.get(self.gateway.make_url(path)) as response:
                    self.assertEqual(response.status, 404)
            async with client.get(
                self.base + "/v1/capabilities",
                headers={"Origin": "https://untrusted.example"},
            ) as response:
                self.assertEqual(response.status, 403)
            async with client.get(
                self.base + "/v1/capabilities",
                headers={"Origin": "https://demo.example"},
            ) as response:
                self.assertEqual(
                    response.headers["Access-Control-Allow-Origin"],
                    "https://demo.example",
                )
                self.assertEqual(response.headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
