**中文** | [English](README.md)

# Qwen3-TTS Browser SDK

这是一个与框架无关的 TypeScript 客户端，用于连接 Qwen3-TTS 的 OpenAI Realtime 入口。
它会先读取当前实例的 capabilities，只允许使用服务明确声明的任务、音频格式、VAD、交付
策略和协议扩展。

## 安装

优先复制当前实例 `/demo/#/sdk` 页面给出的精确版本：

```bash
npm install @xmultimodalinteraction/qwen3tts-browser
```

浏览器必须支持 WebSocket、Web Audio、BigInt 和 ES2022 module。HTTPS 安全上下文中
优先使用 AudioWorklet；普通 HTTP 页面会自动降级到标准
`AudioBufferSourceNode` 调度播放，因此文本合成、`ws://` 流式接收和系统默认扬声器
播放不需要证书。只有麦克风录音或选择输出设备等安全上下文能力要求 HTTPS。

## 合成并播放

```ts
import {
  AudioEncoding,
  BrowserAudioPlayer,
  RealtimeTTSClient,
  SynthesisTask,
  VadStrategy,
} from "@xmultimodalinteraction/qwen3tts-browser";

const client = new RealtimeTTSClient({
  capabilitiesUrl: new URL("../v1/capabilities", location.href),
  websocketUrl: new URL("../v1/realtime", location.href),
});
const player = new BrowserAudioPlayer(); // 默认一小时异常保护上界

await player.start(); // 必须由用户点击等手势触发
client.onEvent((event) => {
  if (event.type === "audio") {
    player.enqueue(event.pcm, 24_000, event.startSample, event.endSample);
  }
});

await client.connect();
const run = await client.synthesize("你好，欢迎使用 Qwen3-TTS。", {
  task: SynthesisTask.CustomVoice,
  speaker: "serena",
  audio: {encoding: AudioEncoding.PcmS16Le, sample_rate: 24_000, channels: 1},
  vad: {enabled: false, strategy: VadStrategy.Disabled},
});
await run.done;
player.flush(); // 提交重采样器保留的尾帧
```

## 播放和文件保存

`BrowserAudioPlayer` 提供连续重采样、有界队列、暂停恢复和播放 sample 游标。使用 guarded
delivery 时，把播放进度传给 `run.acknowledgePlayback()`；Demo 中已经有完整用法。
默认队列使用一小时的异常保护上界，用于容纳服务在句尾校验完成后集中释放的有效尾段。
它不会预分配一小时内存，音频会边播放边释放；内存受限的应用可以通过
`new BrowserAudioPlayer({maxBufferMs: ...})` 显式调小。

`WavCollector` 独立收集可下载 WAV，并设置内存上限。达到上限只停止文件收集，不会中断
实时播放。

内网无需麦克风和输出设备选择时，可以直接使用
`http://<host>:<port>/demo/` 与 `ws://<host>:<port>/v1/realtime`。HTTPS 页面不能连接
`ws://`，因此公网 HTTPS 门户应继续使用同源 `wss://`。

## 生命周期

- 为一次用户操作创建或启动播放器，避免浏览器自动播放策略拒绝 `AudioContext`。
- 一条 client 连接上顺序执行 response；并发合成使用多个 client。
- 等待 `run.done` 获取明确终态，不要把“收到第一个音频块”当作完成。
- 页面卸载时关闭 client 和 player，并释放 `URL.createObjectURL()` 创建的地址。
- API Key 不应出现在公开网页 bundle；需要鉴权时由可信后端签发短期凭据或代理请求。
