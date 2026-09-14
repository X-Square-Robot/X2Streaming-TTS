import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Cable,
  Check,
  Download,
  Headphones,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Square,
  Volume2,
} from "lucide-react";
import { SynthesisTask } from "@xmultimodalinteraction/qwen3tts-browser";
import { assets } from "./assets";
import { useText } from "./i18n";
import { connectEngine, type Connection } from "./live/connection";
import { useStreamingSession } from "./live/useStreamingSession";
import {
  progressSampleBigInt,
  progressRawEnd,
  sortProgressEvents,
} from "./upstream/progress";
import { PlaybackWaveform } from "./upstream/components/PlaybackWaveform";
import { ProgressTrack } from "./upstream/components/ProgressTrack";
import { MediaPlayer } from "./upstream/components/MediaPlayer";

const presets = [
  {
    en: "Numbers & symbols",
    zh: "数字与符号",
    text: "今天的气温是23°C，空气湿度为65%。请在下午3:30前到达会议室，会议预计持续45分钟。",
  },
  {
    en: "A continuous story",
    zh: "连续讲述",
    text: "傍晚，小河狸沿着河岸慢慢散步。远处的灯一盏接一盏亮了起来，水面映着暖暖的光。它停下脚步，听见风穿过树林，像有人在轻轻讲一个还没有结束的故事。",
  },
  {
    en: "English",
    zh: "英文",
    text: "The parcel arrives tomorrow. You can interrupt me at any time, and the conversation can continue from the words that have already been played.",
  },
];

export function Studio() {
  const t = useText();
  const [tab, setTab] = useState<"recording" | "live">("recording");
  return (
    <section
      className="section studio-section"
      id="demo"
      aria-labelledby="demo-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / {t("LISTEN & EXPLORE", "试听与体验")}</p>
          <h2 id="demo-heading">
            {t("Hear it. Follow every word.", "听见声音，也看见进度。")}
          </h2>
        </div>
        <p>
          {t(
            "Start with a real session recording, or connect your engine and try your own words.",
            "先观看真实会话录屏，也可以连接引擎，试试你自己的文字。",
          )}
        </p>
      </div>
      <div className="studio-shell">
        <div className="studio-bar">
          <div
            role="tablist"
            aria-label={t("Demo mode", "演示模式")}
            className="segment-control"
          >
            <button
              role="tab"
              id="recording-tab"
              aria-controls="studio-panel"
              aria-selected={tab === "recording"}
              onClick={() => setTab("recording")}
            >
              <Play size={15} />
              {t("Recorded demo", "真实录屏")}
            </button>
            <button
              role="tab"
              id="live-tab"
              aria-controls="studio-panel"
              aria-selected={tab === "live"}
              onClick={() => setTab("live")}
            >
              <Radio size={15} />
              {t("Live playground", "实时体验")}
            </button>
          </div>
          <span className="studio-signature">
            X2STREAMING <span>×</span> NATIVECURSOR
          </span>
        </div>
        <div id="studio-panel" role="tabpanel" aria-labelledby={`${tab}-tab`}>
          {tab === "recording" ? <Recording /> : <LivePlayground />}
        </div>
      </div>
    </section>
  );
}

function Recording() {
  const t = useText();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [error, setError] = useState("");
  async function play() {
    try {
      await video.current?.play();
      setHasPlayed(true);
    } catch {
      setError(
        t("Please use the video controls to play.", "请使用视频控件播放。"),
      );
    }
  }
  return (
    <div className="recording-grid">
      <div className="recording-stage">
        <div className="recording-label">
          <span className="status-dot" />
          {t("REAL ENGINE RECORDING", "真实引擎会话")}
        </div>
        <video
          ref={video}
          src={assets.recording}
          controls
          playsInline
          preload="metadata"
          aria-label={t(
            "NativeCursor synchronized highlighting recording",
            "NativeCursor 同步高亮录屏",
          )}
          onPlay={() => {
            setPlaying(true);
            setHasPlayed(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() =>
            setError(t("The recording could not be loaded.", "录屏加载失败。"))
          }
        />
        {!hasPlayed && (
          <button
            className="recording-play"
            onClick={() => void play()}
            aria-label={t("Play the recorded session", "播放真实会话")}
          >
            <Play size={24} fill="currentColor" />
          </button>
        )}
        <div className="recording-caption">
          <Volume2 size={15} />
          <span>
            {t(
              "Original session audio · turn sound on",
              "包含会话原声 · 建议打开声音",
            )}
          </span>
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </div>
      <aside className="recording-copy">
        <span className="small-tag">X2-NativeCursor</span>
        <h3>
          {t(
            "The voice moves.\nThe cursor follows.",
            "声音在向前，\n光标也跟上。",
          )}
        </h3>
        <p>
          {t(
            "Follow the original text as speech plays. Even when “23%” is spoken in a different order, the displayed cursor keeps moving forward.",
            "声音播放到哪里，原文就高亮到哪里。即使“23%”读作“百分之二十三”，显示的游标也始终向前。",
          )}
        </p>
        <ol className="flow-list">
          <li>
            <span>1</span>
            {t("Text arrives incrementally", "文本逐步到达")}
          </li>
          <li>
            <span>2</span>
            {t("Native tokens reveal progress", "从原生 token 读出进度")}
          </li>
          <li>
            <span>3</span>
            {t("Highlight follows the playback clock", "高亮跟随实际播放时钟")}
          </li>
        </ol>
        <button
          className="text-button"
          onClick={() => (playing ? video.current?.pause() : void play())}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
          {playing
            ? t("Pause session", "暂停会话")
            : t("Watch with sound", "播放有声演示")}{" "}
          <ArrowRight size={16} />
        </button>
      </aside>
    </div>
  );
}

function LivePlayground() {
  const t = useText();
  const [endpoint, setEndpoint] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [text, setText] = useState(presets[0]!.text);
  const [speaker, setSpeaker] = useState("");
  const [mode, setMode] = useState<"token" | "full_text">("token");
  const [delayMs, setDelayMs] = useState(90);
  const probeVersion = useRef(0);
  const { view, start, pause, interrupt, reset } = useStreamingSession();
  const caps = connection?.capabilities;
  const active = ["connecting", "generating", "playing"].includes(view.phase);
  const canRun =
    !!connection &&
    !!speaker &&
    !!text.trim() &&
    caps?.tasks.includes(SynthesisTask.CustomVoice) &&
    caps.input_modes?.includes(mode);
  const chars = Array.from(view.text || text);
  const ordered = useMemo(
    () => sortProgressEvents(view.progress),
    [view.progress],
  );
  const played = ordered.filter(
    (event) => progressSampleBigInt(event) <= view.played,
  );
  const boundary = played.reduce(
    (result, event) => Math.max(result, progressRawEnd(event, chars.length)),
    0,
  );
  const basis = played.at(-1)?.meta?.progress_basis;
  const native = typeof basis === "string" && basis.startsWith("native_cursor");
  const progressLabel = native
    ? "NativeCursor"
    : played.length
      ? t("Engine progress", "引擎进度")
      : t("Awaiting progress", "等待进度");
  useEffect(
    () => () => {
      probeVersion.current += 1;
    },
    [],
  );

  async function connect() {
    const version = ++probeVersion.current;
    setConnecting(true);
    setConnectionError("");
    setConnection(null);
    reset();
    try {
      const next = await connectEngine(endpoint);
      if (version !== probeVersion.current) return;
      reset();
      setConnection(next);
      const speakers = next.capabilities.speakers ?? [];
      setSpeaker(
        speakers.includes("robot_service_v1")
          ? "robot_service_v1"
          : (speakers[0] ?? ""),
      );
      setMode(
        next.capabilities.input_modes?.includes("token")
          ? "token"
          : "full_text",
      );
      setSettingsOpen(false);
    } catch (error) {
      if (version === probeVersion.current)
        setConnectionError(
          t(
            "Connection failed. Check the endpoint, HTTPS and CORS settings. ",
            "连接失败，请检查地址、HTTPS 和跨域设置。",
          ) + String(error instanceof Error ? error.message : error),
        );
    } finally {
      if (version === probeVersion.current) setConnecting(false);
    }
  }

  return (
    <div className="live-playground">
      <div className="connection-summary">
        <span>
          <i className={`status-dot ${connection ? "connected" : "offline"}`} />
          {connection
            ? t("Engine available", "引擎可用")
            : t("Connect an engine to synthesize", "连接引擎后即可合成")}
        </span>
        <button
          className="text-button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
          disabled={active}
        >
          <Cable size={15} />
          {t("Connection", "连接设置")}
        </button>
      </div>
      {settingsOpen && (
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label htmlFor="engine-url">
            {t("Engine WebSocket URL", "引擎 WebSocket 地址")}
          </label>
          <div>
            <input
              id="engine-url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="wss://your-engine.example/v1/realtime"
              autoComplete="off"
              spellCheck={false}
              disabled={active || connecting}
            />
            <button
              className="button button-dark"
              disabled={!endpoint.trim() || connecting || active}
            >
              {connecting ? t("Connecting…", "连接中…") : t("Connect", "连接")}
              {connection ? <Check size={16} /> : <ArrowRight size={16} />}
            </button>
          </div>
          <small>
            {t(
              "The address stays in this tab. Uses the engine’s capabilities endpoint and Realtime WebSocket.",
              "地址只保留在当前页面，通过引擎能力接口和 Realtime WebSocket 连接。",
            )}
          </small>
        </form>
      )}
      {connectionError && (
        <p role="alert" className="error-message">
          {connectionError}
        </p>
      )}
      <div className="live-grid">
        <div className="compose-pane">
          <div className="pane-label">
            <span>01 / {t("YOUR TEXT", "输入文本")}</span>
            <span>{Array.from(text).length} / 600</span>
          </div>
          <label className="sr-only" htmlFor="synthesis-text">
            {t("Text to synthesize", "合成文本")}
          </label>
          <textarea
            id="synthesis-text"
            value={text}
            onChange={(event) =>
              setText(Array.from(event.target.value).slice(0, 600).join(""))
            }
            disabled={active}
            spellCheck={false}
          />
          <div className="preset-list">
            {presets.map((preset) => (
              <button
                key={preset.en}
                disabled={active}
                className={text === preset.text ? "selected" : ""}
                onClick={() => setText(preset.text)}
              >
                {t(preset.en, preset.zh)}
              </button>
            ))}
          </div>
          <div className="synthesis-options">
            <label>
              {t("Voice", "音色")}
              <select
                value={speaker}
                disabled={!connection || active}
                onChange={(event) => setSpeaker(event.target.value)}
              >
                {!caps?.speakers?.length && (
                  <option value="">
                    {t("Connect to discover", "连接后获取")}
                  </option>
                )}
                {caps?.speakers?.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Text input", "文本输入")}
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
                disabled={active}
              >
                <option
                  value="token"
                  disabled={!!caps && !caps.input_modes?.includes("token")}
                >
                  {t("Streaming text", "逐步输入")}
                </option>
                <option
                  value="full_text"
                  disabled={!!caps && !caps.input_modes?.includes("full_text")}
                >
                  {t("Complete text", "完整输入")}
                </option>
              </select>
            </label>
          </div>
          {mode === "token" && (
            <label className="arrival-control">
              {t("Text arrival", "文本到达速度")}
              <input
                aria-label={t("Text chunk interval", "文本块间隔")}
                type="range"
                min="30"
                max="300"
                step="10"
                value={delayMs}
                disabled={active}
                onChange={(event) => setDelayMs(Number(event.target.value))}
              />
              <span>
                2 {t("chars", "字")} / {delayMs} ms
              </span>
            </label>
          )}
          <button
            className="button button-primary synthesize"
            disabled={!canRun || active}
            onClick={() =>
              connection && void start(connection, text, mode, speaker, delayMs)
            }
          >
            <Play size={17} fill="currentColor" />
            {active
              ? t("Session in progress", "会话进行中")
              : t("Synthesize & listen", "合成并试听")}
          </button>
          {connection && !caps?.tasks.includes(SynthesisTask.CustomVoice) && (
            <p className="error-message">
              {t(
                "This playground needs a CustomVoice engine.",
                "此体验需要支持 CustomVoice 的引擎。",
              )}
            </p>
          )}
        </div>
        <div className="playback-pane">
          <div className="pane-label">
            <span>02 / {t("FOLLOW THE VOICE", "跟随声音")}</span>
            <span className="small-tag">{progressLabel}</span>
          </div>
          <div
            className="reading-text"
            aria-label={t(
              "Text highlighted by playback position",
              "按播放位置高亮的文本",
            )}
          >
            {chars.map((char, index) => (
              <span
                key={index}
                className={
                  index < boundary
                    ? "spoken"
                    : view.text && index >= view.sent
                      ? "not-arrived"
                      : ""
                }
              >
                {char}
              </span>
            ))}
          </div>
          <PlaybackWaveform
            envelope={view.envelope}
            playedSample={view.played}
          />
          <ProgressTrack
            value={Number(view.played)}
            max={Math.max(1, Number(view.buffered))}
            label={t("Audio playback", "音频播放进度")}
          />
          <div className="playback-transport">
            <span>
              {(Number(view.played) / view.rate).toFixed(2)} /{" "}
              {(Number(view.buffered) / view.rate).toFixed(2)} s
            </span>
            <div>
              <button
                className="icon-button"
                disabled={!active || view.buffered === 0n}
                onClick={() => void pause()}
                aria-label={
                  view.paused
                    ? t("Resume audio", "继续播放")
                    : t("Pause audio", "暂停播放")
                }
              >
                {view.paused ? <Play size={17} /> : <Pause size={17} />}
              </button>
              <button
                className="icon-button"
                disabled={!active}
                onClick={interrupt}
                aria-label={t("Interrupt speech", "打断语音")}
              >
                <Square size={15} />
              </button>
              <button
                className="icon-button"
                disabled={active}
                onClick={reset}
                aria-label={t("Reset session", "重置会话")}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
          <div className="session-metrics">
            <div>
              <span>{t("First audio received", "收到首段音频")}</span>
              <strong>
                {view.firstAudioMs === null
                  ? "—"
                  : Math.round(view.firstAudioMs)}
                <small> ms</small>
              </strong>
            </div>
            <div>
              <span>{t("Server TTFT", "服务端 TTFT")}</span>
              <strong>
                {view.serverMs === null ? "—" : Math.round(view.serverMs)}
                <small> ms</small>
              </strong>
            </div>
            <div>
              <span>{t("Progress anchors", "进度锚点")}</span>
              <strong>{view.progress.length || "—"}</strong>
            </div>
          </div>
          <p className="playback-note">
            <Headphones size={14} />
            {t(
              "Highlight follows played audio, not received audio.",
              "高亮跟随已播放的音频，而非刚收到的音频。",
            )}
          </p>
          {view.phase === "complete" && (
            <p className="complete-message" role="status">
              <Check size={15} />
              {t("Playback complete", "播放完成")}
            </p>
          )}
          {view.phase === "interrupted" && (
            <p className="complete-message" role="status">
              {t("Speech interrupted", "语音已打断")}
            </p>
          )}
        </div>
      </div>
      {view.error && (
        <p className="error-message" role="alert">
          {view.error}
        </p>
      )}
      {view.warning && (
        <p className="small-note" role="status">
          {view.warning}
        </p>
      )}
      {view.interruption && (
        <div className="interruption-result">
          <strong>
            {t("Dialogue history at interruption", "打断时的对话历史")}
          </strong>
          <p>
            {view.interruption.spoken ||
              t(
                "No completed text boundary has been reached.",
                "尚未到达可确认的文本边界。",
              )}
          </p>
          <small>
            {t(
              "Estimated from conservative engine anchors at the playback clock; not the interpolated highlight.",
              "依据播放时钟处引擎返回的保守边界估计，不使用高亮插值。",
            )}
          </small>
        </div>
      )}
      {view.audioUrl && (
        <div className="session-download">
          <MediaPlayer
            src={view.audioUrl}
            label={t("Session audio", "本次会话音频")}
          />
          <a
            className="button button-outline"
            href={view.audioUrl}
            download="x2streaming-session.wav"
          >
            <Download size={16} />
            {t("Download WAV", "下载 WAV")}
          </a>
        </div>
      )}
    </div>
  );
}
