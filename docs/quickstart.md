# Start the live Demo / 启动实时体验

Watch the [Demo](https://x-square-robot.github.io/X2Streaming-TTS/) without installing anything.
To synthesize your own text, run the following on a **Linux x86-64 NVIDIA GPU machine**:

```bash
git clone https://github.com/X-Square-Robot/X2Streaming-TTS.git
cd X2Streaming-TTS
bash quickstart.sh --public
```

The same files are available as a [standalone ZIP](https://x-square-robot.github.io/X2Streaming-TTS/x2streaming-quickstart.zip).
Extract it, enter its directory, and run `bash quickstart.sh --public`.

The machine needs **Python 3.12+, Git, Docker with Compose, and NVIDIA Container Toolkit**.
Docker must be usable by your account and expose the selected GPU. The engine checks
GPU/driver/container compatibility; the launcher does not install drivers or alter
an existing Python environment. Allow space for weights, containers and exported
TensorRT artifacts, and network access to GitHub, Hugging Face and NVIDIA NGC.
The first run downloads about 4.6 GB of model files and compiles TensorRT engines;
this is substantially slower than restarting an existing deployment.

The script downloads the two official models, verifies their checksums, prepares
isolated environments, exports and builds the matching engine, then starts a Demo
gateway. It validates the advertised voice and a completed response containing real
PCM audio before displaying:

```text
服务已就绪。您的 WebSocket 地址是：
wss://<temporary-host>.trycloudflare.com/<private-access-path>/v1/realtime
```

Copy the **entire address** into the Demo's **Live playground / 实时体验** and connect.
Select complete text or streaming text, then synthesize, pause, interrupt, or save a WAV.
The endpoint is held only in the open page's memory.

## 中文说明

先看视频或 GIF 了解能力；需要自己输入文本时，再在 GPU 机器执行上面的三行命令。
脚本会下载官方权重、创建独立环境、导出并编译引擎、启动服务。首次编译需要等待。
只有真实音频检查通过后，才会输出“您的 WebSocket 地址是……”。完整复制到网页
“实时体验”的地址框即可。网页本身不运行模型，也不提供公共 GPU。

`--public` 会通过 Cloudflare 创建临时公开 WSS 地址，以便 HTTPS Demo 连接。
地址含随机访问路径，请只分享给需要体验的人；停止或重启隧道后地址可能变化。
不加 `--public` 只创建本机 WS 地址，适合本机 HTTP 页面。网关只开放能力查询和
Realtime WebSocket；原始引擎端口绑定本机。需要长期服务时，应配置自己的 HTTPS
域名与认证网关。

## Reuse and stop

Rerun the same command with the same work directory to reuse downloads and build
artifacts. After a machine restart, rerun it to restart the gateway. Stop only this
installation with:

```bash
bash quickstart.sh --stop
```

For a specific GPU and persistent work directory:

```bash
bash quickstart.sh --device 1 --work-dir /your/persistent/x2-demo --public
# Use the same directory when stopping:
bash quickstart.sh --work-dir /your/persistent/x2-demo --stop
```

Use a new, dedicated directory; do not select another project's environment or
shared production directory. Ports default to gateway 7860, engine 18660 and gRPC
18661. `--port`, `--engine-port` and `--grpc-port` can change them on a new deployment.
`--allow-origin https://your-demo.example` allows another website to use the gateway.

Already have the original release files? Avoid downloading again:

```bash
bash quickstart.sh --model-dir /path/to/X2Streaming-TTS-1.7B \
  --cursor-dir /path/to/X2-NativeCursor-Qwen3TTS-12Hz --public
```

Both directories must contain their original `SHA256SUMS` and matching files.
The script does not edit the source snapshots. `HF_ENDPOINT` and `HF_HOME` are
respected by the Hugging Face downloader. `bash quickstart.sh --dry-run` prints the
plan without downloading, installing or running inference, including on macOS.

## Versions and capability limits

[manifest.json](../tools/quickstart/manifest.json) pins the public engine commit and
both model revisions. This runtime is separate from the method repository's older
research submodule: do not apply the historical hook patches to this newer runtime.

The original checkpoint's `MODEL_VERSION` remains `cont7e3-f2b8ed5`. The newer
packager requires a `researcher@YYYYMMDD` identifier, so this launcher explicitly
uses `x2demo@<build-date>` for the generated package and preserves the source version
in `.x2-demo/state.json`. The model tensors are unchanged.

The observer head is staged for the engine's fused TensorRT export. NativeCursor
and speech-state capabilities still depend on the engine's manifest and release
validation evidence. Downloading the head alone does not enable them. The launcher
does not bypass those checks or install a CPU observer; the page labels progress
according to capabilities actually reported by the running engine. Recordings show
the recorded reference system and do not imply that every local build has passed
its release gates.

CPU checks cover integrity failures, Realtime protocol handling, and gateway access.
A complete cold GPU build has not yet been validated on the available development
machine, which lacks Docker; a successful dry run is not an inference test.

## Sources and licenses

The launcher and gateway are under this repository's [MIT License](../LICENSE).
The separately downloaded model weights retain Apache-2.0. The engine retains its
own MIT license and third-party notices; NVIDIA containers retain NVIDIA's terms.
The optional [Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
uses `cloudflared` (Apache-2.0), downloaded as a separate container. None of those
weights or container binaries is bundled in the starter ZIP.
