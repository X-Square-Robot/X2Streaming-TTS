import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioEncoding,
  BrowserAudioPlayer,
  DeliveryPolicy,
  InputMode,
  RealtimeTTSClient,
  SynthesisTask,
  VadStrategy,
  WavCollector,
  type IncrementalSynthesisRun,
  type SynthesisRun,
  type TTSEvent,
} from "@xmultimodalinteraction/qwen3tts-browser";
import {
  appendAudioEnvelope,
  type AudioEnvelope,
} from "../upstream/components/audio-envelope";
import type { ProgressEvent } from "../upstream/progress";
import type { Connection } from "./connection";
import { playedBoundary, splitText } from "./timeline";

type Phase =
  | "idle"
  | "connecting"
  | "generating"
  | "playing"
  | "complete"
  | "interrupted"
  | "error";
export interface SessionView {
  phase: Phase;
  text: string;
  sent: number;
  played: bigint;
  buffered: bigint;
  rate: number;
  paused: boolean;
  progress: ProgressEvent[];
  envelope: AudioEnvelope[];
  firstAudioMs: number | null;
  serverMs: number | null;
  error: string;
  warning: string;
  audioUrl: string;
  interruption: { spoken: string; unspoken: string } | null;
}
const initial: SessionView = {
  phase: "idle",
  text: "",
  sent: 0,
  played: 0n,
  buffered: 0n,
  rate: 24000,
  paused: false,
  progress: [],
  envelope: [],
  firstAudioMs: null,
  serverMs: null,
  error: "",
  warning: "",
  audioUrl: "",
  interruption: null,
};

interface ActiveSession {
  id: number;
  client: RealtimeTTSClient;
  player: BrowserAudioPlayer;
  run: SynthesisRun | null;
  collector: WavCollector;
  progress: ProgressEvent[];
  text: string;
  finished: boolean;
  cancelled: boolean;
  audioUrl: string;
  rate: number;
  received: bigint;
}

export function useStreamingSession() {
  const [view, setView] = useState<SessionView>(initial);
  const active = useRef<ActiveSession | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const alive = (session: ActiveSession) =>
    mounted.current && active.current === session && !session.cancelled;

  const dispose = useCallback(() => {
    const session = active.current;
    active.current = null;
    if (!session) return;
    session.cancelled = true;
    session.client.close();
    void session.player.close().catch(() => {});
    if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dispose();
    };
  }, [dispose]);

  async function start(
    connection: Connection,
    text: string,
    mode: "token" | "full_text",
    speaker: string,
    delayMs: number,
  ) {
    dispose();
    const caps = connection.capabilities;
    const audio = caps.audio_formats.find(
      (format) => format.encoding === AudioEncoding.PcmS16Le,
    );
    if (
      !audio ||
      !caps.tasks.includes(SynthesisTask.CustomVoice) ||
      !caps.input_modes?.includes(mode)
    ) {
      setView({
        ...initial,
        phase: "error",
        error: "The connected engine does not support this voice / input mode.",
      });
      return;
    }
    setView({ ...initial, phase: "connecting", text, rate: audio.sample_rate });
    const client = new RealtimeTTSClient({
      ...connection,
      connectTimeoutMs: 10000,
    });
    let requestAt = 0;
    const player = new BrowserAudioPlayer({
      maxBufferMs: 180000,
      onPlaybackProgress: (played, buffered) => {
        if (!alive(session)) return;
        try {
          session.run?.acknowledgePlayback(played, buffered);
        } catch {
          /* Transport may have just ended. */
        }
        setView((current) => ({
          ...current,
          played,
          buffered,
          phase:
            session.finished && player.snapshot().queuedFrames === 0
              ? "complete"
              : current.phase,
        }));
      },
      onError: (error) => fail(error.message),
      onFallback: () => {
        if (alive(session))
          setView((current) => ({
            ...current,
            warning: "Using browser-compatible audio playback.",
          }));
      },
    });
    const session: ActiveSession = {
      id: ++generation.current,
      client,
      player,
      run: null,
      collector: new WavCollector({ sampleRate: audio.sample_rate }),
      progress: [],
      text,
      finished: false,
      cancelled: false,
      audioUrl: "",
      rate: audio.sample_rate,
      received: 0n,
    };
    active.current = session;

    function saveAudio() {
      if (!session.collector.snapshot().samples) return;
      if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
      session.audioUrl = URL.createObjectURL(session.collector.toBlob());
      setView((current) => ({ ...current, audioUrl: session.audioUrl }));
    }
    function fail(message: string) {
      if (!alive(session)) return;
      session.cancelled = true;
      client.close();
      void player.close().catch(() => {});
      saveAudio();
      setView((current) => ({
        ...current,
        phase: "error",
        error: message,
        paused: false,
      }));
    }
    client.onEvent((event: TTSEvent) => {
      if (!alive(session)) return;
      if (event.type === "audio") {
        session.received = event.endSample;
        session.collector.append(event.pcm);
        try {
          player.enqueue(
            event.pcm,
            audio.sample_rate,
            event.startSample,
            event.endSample,
          );
        } catch (error) {
          fail(String(error));
          return;
        }
        setView((current) => ({
          ...current,
          buffered: event.endSample,
          envelope: appendAudioEnvelope(
            current.envelope,
            event.pcm,
            event.startSample,
            event.endSample,
          ),
          firstAudioMs: current.firstAudioMs ?? performance.now() - requestAt,
          serverMs: event.server?.ttft_ms ?? current.serverMs,
          warning: session.collector.snapshot().limitReached
            ? "WAV download reached its size limit."
            : current.warning,
        }));
      } else if (event.type === "progress") {
        session.progress.push(event);
        setView((current) => ({ ...current, progress: [...session.progress] }));
      } else if (event.type === "error")
        fail(`${event.code}: ${event.message}`);
      else if (event.type === "warning")
        setView((current) => ({ ...current, warning: event.message }));
    });
    try {
      // Initialize audio from the user's click before opening the network session.
      await player.start();
      if (!alive(session)) return;
      await client.connect();
      if (!alive(session)) return;
      const options = {
        task: SynthesisTask.CustomVoice,
        speaker,
        language: caps.languages?.includes("auto")
          ? "auto"
          : (caps.languages?.[0] ?? "Chinese"),
        inputMode: mode === "token" ? InputMode.Token : InputMode.FullText,
        audio,
        vad: { strategy: VadStrategy.Disabled, enabled: false },
        delivery: DeliveryPolicy.Guarded,
        outputPolicy: { emit_text_events: true },
      };
      requestAt = performance.now();
      const run =
        mode === "token"
          ? await client.startIncremental(options)
          : await client.synthesize(text, options);
      if (!alive(session)) {
        run.cancel();
        return;
      }
      session.run = run;
      setView((current) => ({
        ...current,
        phase: "generating",
        sent: mode === "full_text" ? Array.from(text).length : 0,
      }));
      if (mode === "token") {
        let sent = 0;
        for (const chunk of splitText(text)) {
          if (!alive(session)) return;
          (run as IncrementalSynthesisRun).append(chunk);
          sent += Array.from(chunk).length;
          setView((current) => ({ ...current, sent }));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (!alive(session)) return;
        (run as IncrementalSynthesisRun).commit();
      }
      const terminal = await run.done;
      if (!alive(session)) return;
      if (terminal.type === "error") {
        fail(`${terminal.code}: ${terminal.message}`);
        return;
      }
      if (terminal.type === "cancelled") {
        fail("The engine cancelled this response.");
        return;
      }
      player.flush();
      session.finished = true;
      saveAudio();
      setView((current) => ({
        ...current,
        phase: player.snapshot().queuedFrames > 0 ? "playing" : "complete",
        serverMs:
          terminal.type === "completed"
            ? (terminal.server?.ttft_ms ?? current.serverMs)
            : current.serverMs,
      }));
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  async function pause() {
    const session = active.current;
    if (!session || session.cancelled) return;
    const paused = session.player.snapshot().paused;
    try {
      if (paused) await session.player.resume();
      else await session.player.pause();
      if (alive(session))
        setView((current) => ({ ...current, paused: !paused }));
    } catch (error) {
      setView((current) => ({ ...current, warning: String(error) }));
    }
  }

  function interrupt() {
    const session = active.current;
    if (!session || session.cancelled) return;
    const snapshot = session.player.snapshot();
    const chars = Array.from(session.text);
    const boundary = playedBoundary(
      session.progress,
      snapshot.playedThroughSample,
      chars.length,
    );
    session.cancelled = true;
    try {
      session.run?.acknowledgePlayback(
        snapshot.playedThroughSample,
        snapshot.bufferedThroughSample,
      );
      session.run?.cancel();
    } catch {
      /* Already closed. */
    }
    session.client.close();
    void session.player.close().catch(() => {});
    setView((current) => ({
      ...current,
      phase: "interrupted",
      paused: false,
      played: snapshot.playedThroughSample,
      interruption: {
        spoken: chars.slice(0, boundary).join(""),
        unspoken: chars.slice(boundary).join(""),
      },
    }));
  }

  return {
    view,
    start,
    pause,
    interrupt,
    reset: () => {
      dispose();
      setView(initial);
    },
  };
}
