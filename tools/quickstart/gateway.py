"""Demo-only HTTP/WebSocket gateway; the upstream engine owns synthesis."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

CLIENT = web.AppKey("client", ClientSession)


def create_app(upstream: str, access: str, origins: set[str]) -> web.Application:
    if not access or "/" in access:
        raise ValueError("A nonempty, single-segment access code is required")
    app = web.Application(client_max_size=8 * 1024 * 1024)

    async def session_context(app):
        app[CLIENT] = ClientSession(timeout=ClientTimeout(total=None, connect=15))
        yield
        await app[CLIENT].close()

    app.cleanup_ctx.append(session_context)

    def origin_headers(request):
        origin = request.headers.get("Origin")
        if origin and origin not in origins:
            raise web.HTTPForbidden(text="Origin is not allowed")
        return (
            {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else {}
        )

    async def capabilities(request):
        headers = origin_headers(request)
        headers["Cache-Control"] = "no-store"
        try:
            async with request.app[CLIENT].get(
                upstream + "/v1/capabilities", timeout=15
            ) as response:
                if response.status != 200:
                    raise web.HTTPBadGateway(text="Engine capabilities unavailable")
                payload = await response.json()
            return web.json_response(payload, headers=headers)
        except (OSError, asyncio.TimeoutError) as exc:
            raise web.HTTPBadGateway(text="Engine unavailable") from exc

    async def realtime(request):
        origin_headers(request)
        remote_url = upstream.replace("https://", "wss://", 1).replace(
            "http://", "ws://", 1
        )
        remote = await request.app[CLIENT].ws_connect(
            remote_url + "/v1/realtime", max_msg_size=8 * 1024 * 1024
        )
        local = web.WebSocketResponse(max_msg_size=8 * 1024 * 1024, heartbeat=30)
        try:
            await local.prepare(request)

            async def forward(source, target):
                async for message in source:
                    if message.type == WSMsgType.TEXT:
                        await target.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await target.send_bytes(message.data)
                    elif message.type in {
                        WSMsgType.ERROR,
                        WSMsgType.CLOSE,
                        WSMsgType.CLOSED,
                    }:
                        break

            tasks = [
                asyncio.create_task(forward(local, remote)),
                asyncio.create_task(forward(remote, local)),
            ]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            await remote.close()
            with contextlib.suppress(Exception):
                await local.close()
        return local

    app.router.add_get(f"/{access}/v1/capabilities", capabilities)
    app.router.add_get(f"/{access}/v1/realtime", realtime)
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--access-file", type=Path, required=True)
    parser.add_argument("--allow-origin", action="append", default=[])
    args = parser.parse_args()
    app = create_app(
        args.upstream.rstrip("/"),
        args.access_file.read_text().strip(),
        set(args.allow_origin),
    )
    # Access logs would expose the private connection path.
    web.run_app(app, host="127.0.0.1", port=args.port, access_log=None)
