#!/usr/bin/env python3
"""Reproducible local deployment using the upstream TensorRT lifecycle."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import platform
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / "manifest.json").read_text())


def run(command, *, cwd=None, env=None, capture=False):
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        check=True,
        stdin=subprocess.DEVNULL,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    ).stdout


def parser():
    result = argparse.ArgumentParser(
        description="Download X2 weights, build TensorRT, start the Demo service and print its WebSocket address."
    )
    result.add_argument("--work-dir", type=Path, default=Path.cwd() / ".x2-demo")
    result.add_argument(
        "--device", type=int, default=0, help="Physical NVIDIA GPU index"
    )
    result.add_argument(
        "--port", type=int, default=7860, help="Local Demo gateway port"
    )
    result.add_argument("--engine-port", type=int, default=18660)
    result.add_argument("--grpc-port", type=int, default=18661)
    result.add_argument(
        "--public",
        action="store_true",
        help="Create a temporary public WSS URL through Cloudflare for the online Demo",
    )
    result.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        help="Additional trusted browser origin",
    )
    result.add_argument(
        "--model-dir",
        type=Path,
        help="Reuse a local original TTS snapshot instead of downloading",
    )
    result.add_argument(
        "--cursor-dir",
        type=Path,
        help="Reuse a local original cursor snapshot instead of downloading",
    )
    result.add_argument(
        "--ngc-tag", help="Explicit upstream-supported NVIDIA container tag"
    )
    result.add_argument(
        "--engine-repository",
        default=MANIFEST["engine_repository"],
        help="Repository containing the pinned Realtime runtime",
    )
    result.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the plan; no downloads, installation or GPU work",
    )
    result.add_argument(
        "--stop",
        action="store_true",
        help="Stop only the services owned by this work directory",
    )
    return result


def save(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(path)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_snapshot(folder):
    checksums = folder / "SHA256SUMS"
    if not checksums.is_file():
        raise ValueError(f"Missing release checksums: {checksums}")
    verified = {}
    for line in checksums.read_text().splitlines():
        if not line.strip():
            continue
        expected, relative = line.split(maxsplit=1)
        if not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise ValueError("Invalid SHA-256 checksum")
        candidate = (folder / relative.lstrip("*")).resolve()
        if not candidate.is_relative_to(folder.resolve()) or not candidate.is_file():
            raise ValueError(f"Missing or invalid release file: {relative}")
        if digest(candidate) != expected:
            raise ValueError(f"Checksum mismatch: {relative}")
        verified[relative.lstrip("*")] = expected
    if not verified:
        raise ValueError("The release checksum list is empty")
    return verified


def owned_gateway(root, pid):
    try:
        command = Path(f"/proc/{int(pid)}/cmdline").read_bytes().split(b"\0")
        return (
            str(HERE / "gateway.py").encode() in command
            and str(root / "access.txt").encode() in command
        )
    except (OSError, ValueError, TypeError):
        return False


def stop(root, state, name):
    if owned_gateway(root, state.get("gateway_pid")):
        os.kill(state["gateway_pid"], signal.SIGTERM)
    for suffix, label in [
        ("-engine", "com.docker.compose.project"),
        ("-tunnel", "x2.quickstart"),
    ]:
        inspect = subprocess.run(
            ["docker", "inspect", name + suffix], capture_output=True, text=True
        )
        if inspect.returncode == 0:
            labels = (
                json.loads(inspect.stdout)[0].get("Config", {}).get("Labels", {}) or {}
            )
            if labels.get(label) == name:
                run(["docker", "stop", name + suffix])
    print("本工作目录的 Demo 服务已停止。/ This work directory's services are stopped.")


def require_free_port(port):
    if not 1024 <= port <= 65535:
        raise ValueError("Use an unprivileged port between 1024 and 65535")
    with socket.socket() as sock:
        sock.bind(("0.0.0.0", port))


def bootstrap(root):
    interpreter = root / "tools-env/bin/python"
    requirements = HERE / "requirements.txt"
    marker = root / "tools-requirements.sha256"
    if not interpreter.exists():
        venv.create(root / "tools-env", with_pip=True)
    fingerprint = digest(requirements)
    if not marker.exists() or marker.read_text() != fingerprint:
        run([str(interpreter), "-m", "pip", "install", "-r", str(requirements)])
        marker.write_text(fingerprint)
    if Path(sys.prefix).resolve() != interpreter.parent.parent.resolve():
        os.execv(
            str(interpreter),
            [str(interpreter), str(Path(__file__).resolve()), *sys.argv[1:]],
        )


def model_sources(args, root):
    from huggingface_hub import snapshot_download

    paths = []
    for kind, existing in [("tts", args.model_dir), ("cursor", args.cursor_dir)]:
        if existing:
            path = existing.expanduser().resolve()
        else:
            path = Path(
                snapshot_download(
                    repo_id=MANIFEST[f"{kind}_repository"],
                    revision=MANIFEST[f"{kind}_revision"],
                    local_dir=root / "downloads" / kind,
                )
            )
        print(f"Checking {kind} release files…", flush=True)
        verified = validate_snapshot(path)
        if (
            kind == "tts"
            and verified.get("model.safetensors") != MANIFEST["tts_sha256"]
        ):
            raise ValueError("Expected the pinned TTS checkpoint weights")
        paths.append(path)
    config = json.loads((paths[0] / "config.json").read_text())
    if config.get(
        "tts_model_type"
    ) != "custom_voice" or "robot_service_v1" not in config.get(
        "talker_config", {}
    ).get("spk_id", {}):
        raise ValueError(
            "Expected the published robot_service_v1 CustomVoice checkpoint"
        )
    head = paths[1] / "qwen3_tts_12hz_la1_seed0.pt"
    if digest(head) != MANIFEST["cursor_sha256"]:
        raise ValueError("The cursor head is not the matching released head")
    return paths


def link(source, target):
    if target.is_symlink() and target.resolve() == source.resolve():
        return
    if target.exists() or target.is_symlink():
        raise ValueError(f"Refusing to replace an existing path: {target}")
    target.symlink_to(source, target_is_directory=source.is_dir())


def prepare_engine(args, root, state, statefile, name):
    import yaml

    engine = root / "engine"
    if not engine.exists():
        run(
            [
                "git",
                "clone",
                "--no-checkout",
                "--filter=blob:none",
                args.engine_repository,
                str(engine),
            ]
        )
        run(["git", "checkout", "--detach", MANIFEST["engine_commit"]], cwd=engine)
    if (
        run(["git", "rev-parse", "HEAD"], cwd=engine, capture=True).strip()
        != MANIFEST["engine_commit"]
    ):
        raise ValueError("Engine pin changed; use a new --work-dir")
    if run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=engine,
        capture=True,
    ).strip():
        raise ValueError("Engine source has local edits; use a new --work-dir")
    run(["git", "submodule", "update", "--init", "--recursive"], cwd=engine)
    tts, cursor = model_sources(args, root)
    models = engine / "workspace/models"
    stage = models / "Qwen3-TTS-12Hz-1.7B-CustomVoice"
    stage.mkdir(parents=True, exist_ok=True)
    for source in tts.iterdir():
        if source.name != ".cache":
            link(source, stage / source.name)
    link(cursor / "qwen3_tts_12hz_la1_seed0.pt", stage / "qwen3_tts_12hz_la1_seed0.pt")
    link(tts / "speech_tokenizer", models / "Qwen3-TTS-Tokenizer-12Hz")
    config = yaml.safe_load((engine / "engine.yaml").read_text())
    config.setdefault("prefill", {}).update(
        default_speaker="robot_service_v1", fallback_speaker="robot_service_v1"
    )
    config.setdefault("sampling", {}).update(
        temperature=0.9, top_k=50, repetition_penalty=1.05
    )
    config.setdefault("observability", {})["text_capture"] = "disabled"
    config_file = root / "engine.yaml"
    config_file.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False))
    release = state.setdefault("package_release", "x2demo@" + time.strftime("%Y%m%d"))
    state["original_model_version"] = (tts / "MODEL_VERSION").read_text().strip()
    env = {
        **os.environ,
        "ENV_NAME": str(root / "export-env"),
        "PATH": str(root / "tools-env/bin") + os.pathsep + os.environ["PATH"],
        "WORKDIR": str(engine / "workspace"),
        "MODEL_VARIANT": "custom-1.7b",
        "SKIP_MODELS": "1",
        "SKIP_EXPORT": "1",
        "EXPORT_DEVICE": f"cuda:{args.device}",
        "QWEN3_TTS_MODEL_RELEASE_VERSION": release,
        "COMPOSE_PROJECT_NAME": name,
        "ENGINE_CONTAINER_NAME": name + "-engine",
        "ENGINE_IMAGE": name + ":runtime",
        "ENGINE_BIND_HOST": "127.0.0.1",
        "ENGINE_CONFIG_FILE": str(config_file),
        "ENGINE_PREFILL_DEFAULT_SPEAKER": "robot_service_v1",
        "ENGINE_PREFILL_FALLBACK_SPEAKER": "robot_service_v1",
    }
    if args.ngc_tag:
        env["NGC_TAG"] = args.ngc_tag
    phases = state.setdefault("phases", [])
    if "setup" not in phases or not (root / "export-env/bin/python").exists():
        print("Preparing an isolated export environment…", flush=True)
        # Force the pinned upstream venv backend within the same shell. No conda/base mutation.
        run(
            [
                "bash",
                "-c",
                "set -e; source scripts/bash/tools.sh; VENV_CMD=venv; source scripts/bash/setup_env.sh",
            ],
            cwd=engine,
            env=env,
        )
        phases.append("setup")
        save(statefile, state)
    env["PATH"] = str(root / "export-env/bin") + os.pathsep + os.environ["PATH"]
    env["VIRTUAL_ENV"] = str(root / "export-env")
    exported = engine / "workspace/exported/custom-1.7b"
    if "export" not in phases or not (exported / "triton_manifest.json").exists():
        run(
            [
                str(root / "export-env/bin/python"),
                "scripts/export/export_all.py",
                "--variant",
                "custom-1.7b",
                "--device",
                f"cuda:{args.device}",
                "--dtype",
                "bf16",
                "--skip-verification",
            ],
            cwd=engine,
            env=env,
        )
        phases.append("export")
        save(statefile, state)
    common = ["-m", "custom-1.7b", "--yes", "--device", str(args.device)]
    if args.ngc_tag:
        common += ["--ngc-tag", args.ngc_tag]
    # Upstream performs its own target fingerprint checks and artifact reuse.
    run(
        [
            "bash",
            "scripts/bash/autorun.sh",
            "build",
            *common,
            "--max-batch-size",
            "4",
            "--max-input-len",
            "128",
            "--max-seq-len",
            "512",
            "--dtype",
            "bf16",
        ],
        cwd=engine,
        env=env,
    )
    deploy = [
        *common,
        "--gateway",
        "engine-docker",
        "--engine-image",
        name + ":runtime",
        "--port",
        str(args.grpc_port),
        "--ws-port",
        str(args.engine_port),
        "--max-sessions",
        "4",
        "--runtime-max-batch-size",
        "4",
        "--runtime-max-seq-len",
        "512",
    ]
    run(
        ["bash", "scripts/bash/autorun.sh", "package", *deploy, "--build"],
        cwd=engine,
        env=env,
    )
    run(["bash", "scripts/bash/autorun.sh", "deploy", *deploy], cwd=engine, env=env)
    save(statefile, state)


async def wait_ready(base, *, origin=None, synthesize=True, seconds=180):
    from service import probe

    deadline = time.monotonic() + seconds
    last = ""
    while time.monotonic() < deadline:
        try:
            return await probe(base, origin=origin, synthesize=synthesize)
        except Exception as exc:
            last = str(exc)
            await asyncio.sleep(3)
    raise RuntimeError(f"Service did not pass readiness/audio validation: {last}")


def main():
    args = parser().parse_args()
    root = args.work_dir.expanduser().resolve()
    name = "x2demo-" + hashlib.sha256(str(root).encode()).hexdigest()[:10]
    statefile = root / "state.json"
    state = json.loads(statefile.read_text()) if statefile.exists() else {}
    if args.dry_run:
        print(
            json.dumps(
                {
                    "work_dir": str(root),
                    "pins": MANIFEST,
                    "steps": [
                        "preflight Linux/NVIDIA/Docker",
                        "create isolated environments",
                        "download and verify pinned TTS + cursor",
                        "export ONNX; build TensorRT; package/start isolated engine",
                        "verify real PCM synthesis",
                        "start origin-restricted Demo gateway",
                        "create temporary public WSS tunnel"
                        if args.public
                        else "use local WS",
                        "verify WebSocket and print address",
                    ],
                    "public": args.public,
                    "ports": [args.port, args.engine_port, args.grpc_port],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    if args.stop:
        stop(root, state, name)
        return
    if (
        sys.version_info < (3, 12)
        or platform.system() != "Linux"
        or platform.machine() not in {"x86_64", "AMD64"}
    ):
        raise RuntimeError(
            "Run on Linux x86-64 with Python 3.12+, NVIDIA GPU, Docker Compose and NVIDIA Container Toolkit. Use --dry-run anywhere."
        )
    for command in ["git", "docker", "nvidia-smi"]:
        if not shutil.which(command):
            raise RuntimeError(f"Missing prerequisite: {command}")
    run(["docker", "info"], capture=True)
    run(["docker", "compose", "version"], capture=True)
    gpu = run(
        [
            "nvidia-smi",
            "-i",
            str(args.device),
            "--query-gpu=uuid,driver_version",
            "--format=csv,noheader",
        ],
        capture=True,
    ).strip()
    if len({args.port, args.engine_port, args.grpc_port}) != 3:
        raise ValueError("The three ports must be different")
    identity = {
        "pins": MANIFEST,
        "engine_repository": args.engine_repository,
        "gpu": gpu,
        "ports": [args.port, args.engine_port, args.grpc_port],
        "ngc_tag": args.ngc_tag,
        "allow_origins": sorted(args.allow_origin),
        "model_dir": str(args.model_dir.resolve()) if args.model_dir else None,
        "cursor_dir": str(args.cursor_dir.resolve()) if args.cursor_dir else None,
    }
    if state and state.get("identity") != identity:
        raise ValueError(
            "Deployment inputs changed. Choose a new --work-dir to preserve this deployment."
        )
    if root.exists() and not statefile.exists() and any(root.iterdir()):
        raise ValueError("Use an empty, dedicated --work-dir")
    root.mkdir(parents=True, exist_ok=True)
    save(statefile, {**state, "identity": identity})
    root.chmod(0o700)
    bootstrap(root)
    from service import websocket_url

    state["identity"] = identity
    save(statefile, state)
    local_engine = f"http://127.0.0.1:{args.engine_port}"
    if not state.get("started"):
        existing = subprocess.run(
            ["docker", "inspect", name + "-engine"], capture_output=True, text=True
        )
        if existing.returncode == 0:
            record = json.loads(existing.stdout)[0]
            if (record["Config"].get("Labels") or {}).get(
                "com.docker.compose.project"
            ) != name:
                raise RuntimeError(
                    "The engine container name belongs to another deployment"
                )
            # Resume a deployment whose container started before the launcher exited.
        else:
            for port in [args.port, args.engine_port, args.grpc_port]:
                require_free_port(port)
            prepare_engine(args, root, state, statefile, name)
        state["started"] = True
        save(statefile, state)
    container = json.loads(run(["docker", "inspect", name + "-engine"], capture=True))[
        0
    ]
    if (container["Config"].get("Labels") or {}).get(
        "com.docker.compose.project"
    ) != name:
        raise RuntimeError("The engine container is not owned by this deployment")
    if not container.get("State", {}).get("Running"):
        run(["docker", "start", name + "-engine"], capture=True)
    print("Validating the loaded voice and a real audio response…", flush=True)
    caps = asyncio.run(wait_ready(local_engine))
    access_file = root / "access.txt"
    if not access_file.exists():
        access_file.write_text(secrets.token_urlsafe(24))
        access_file.chmod(0o600)
    access = access_file.read_text().strip()
    origins = [
        "https://x-square-robot.github.io",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        *args.allow_origin,
    ]
    if not owned_gateway(root, state.get("gateway_pid")):
        require_free_port(args.port)
        command = [
            sys.executable,
            str(HERE / "gateway.py"),
            "--upstream",
            local_engine,
            "--port",
            str(args.port),
            "--access-file",
            str(access_file),
        ]
        for origin in origins:
            command += ["--allow-origin", origin]
        with (root / "gateway.log").open("ab") as log:
            child = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
        state["gateway_pid"] = child.pid
        save(statefile, state)
    base = f"http://127.0.0.1:{args.port}/{access}"
    asyncio.run(wait_ready(base, origin=origins[0], synthesize=False, seconds=30))
    if args.public:
        tunnel = name + "-tunnel"
        record = {}
        exists = subprocess.run(
            ["docker", "inspect", tunnel], capture_output=True, text=True
        )
        if exists.returncode == 0:
            record = json.loads(exists.stdout)[0]
            if (record["Config"].get("Labels") or {}).get("x2.quickstart") != name:
                raise RuntimeError("Tunnel name is owned by another deployment")
            run(["docker", "start", tunnel], capture=True)
        else:
            run(
                [
                    "docker",
                    "run",
                    "-d",
                    "--name",
                    tunnel,
                    "--label",
                    f"x2.quickstart={name}",
                    "--network",
                    "host",
                    "--restart",
                    "unless-stopped",
                    MANIFEST["cloudflared_image"],
                    "tunnel",
                    "--no-autoupdate",
                    "--url",
                    f"http://127.0.0.1:{args.port}",
                ],
                capture=True,
            )
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            logs = subprocess.run(
                ["docker", "logs", "--since", "3m", tunnel],
                capture_output=True,
                text=True,
            )
            urls = re.findall(
                r"https://[a-z0-9-]+\.trycloudflare\.com", logs.stdout + logs.stderr
            )
            if urls:
                base = urls[-1] + "/" + access
                break
            if state.get("public_base") and record.get("State", {}).get("Running"):
                base = state["public_base"]
                break
            time.sleep(2)
        else:
            raise RuntimeError(
                "The temporary WSS tunnel did not become ready; local engine remains available"
            )
        asyncio.run(wait_ready(base, origin=origins[0], synthesize=False, seconds=90))
        state["public_base"] = base
    state["websocket_url"] = websocket_url(base)
    save(statefile, state)
    print("\n服务已就绪。您的 WebSocket 地址是：\n" + state["websocket_url"])
    print("复制地址，填入 Demo 的「实时体验」：" + MANIFEST["demo_url"] + "#live")
    print(
        "NativeCursor: "
        + (
            "available"
            if caps.get("native_cursor", {}).get("progress_available")
            else "not advertised; recordings remain available"
        )
    )
    if not args.public:
        print("此地址仅供本机使用。连接在线 HTTPS Demo 请加 --public 重新运行。")
    else:
        print(
            "临时公开地址含私有访问路径，请只分享给需要体验的人；重启隧道后地址可能变化。"
        )
    print("停止：bash quickstart.sh --work-dir " + shlex.quote(str(root)) + " --stop")


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print(
            f"\nQuick start failed: {exc}\nNo ready WebSocket address has been announced. Fix this step and rerun with the same --work-dir.",
            file=sys.stderr,
        )
        sys.exit(1)
