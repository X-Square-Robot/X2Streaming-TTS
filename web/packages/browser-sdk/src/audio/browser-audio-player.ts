import {PlaybackCursorQueue} from "./playback-cursor.js";
import {
  DEFAULT_MAX_BUFFER_MS,
  PCM_PLAYER_WORKLET_SOURCE,
} from "./pcm-player-worklet.js";
import {ContinuousResampler, pcm16ToFloat32} from "./resampler.js";
import {ScheduledBufferPlayer} from "./scheduled-buffer-player.js";

export type AudioPlaybackBackend = "audio-worklet" | "scheduled-buffer";
export {DEFAULT_MAX_BUFFER_MS};

export interface BrowserAudioPlayerOptions {
  maxBufferMs?: number;
  onPlaybackProgress?: (played: bigint, buffered: bigint) => void;
  onUnderrun?: () => void;
  onError?: (error: Error) => void;
  onFallback?: (reason: Error) => void;
  startupTimeoutMs?: number;
  workletModuleUrl?: string | URL;
}

export interface AudioPlayerSnapshot {
  sampleRate: number;
  queuedFrames: number;
  playedThroughSample: bigint;
  bufferedThroughSample: bigint;
  underruns: number;
  paused: boolean;
  backend: AudioPlaybackBackend | null;
}

export class AudioQueueOverflowError extends Error {
  readonly code = "audio_queue_overflow";
}

export class BrowserAudioPlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private scheduledPlayer: ScheduledBufferPlayer | null = null;
  private gain: GainNode | null = null;
  private resampler: ContinuousResampler | null = null;
  private sourceRate = 0;
  private sourceBase = 0n;
  private receivedThrough = 0n;
  private readonly cursors = new PlaybackCursorQueue();
  private underruns = 0;
  private paused = false;
  private readonly maxBufferMs: number;
  private readonly options: BrowserAudioPlayerOptions;

  constructor(options: BrowserAudioPlayerOptions = {}) {
    const maxBufferMs = options.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS;
    if (!Number.isFinite(maxBufferMs) || maxBufferMs <= 0) {
      throw new RangeError("maxBufferMs must be a positive finite number");
    }
    this.maxBufferMs = maxBufferMs;
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.context) {
      await this.resume();
      return;
    }
    const context = new AudioContext();
    const gain = context.createGain();
    gain.connect(context.destination);
    let node: AudioWorkletNode | null = null;
    try {
      node = await this.createWorkletNode(context, gain);
    } catch (error) {
      const reason = toError(error);
      this.options.onFallback?.(reason);
      this.scheduledPlayer = new ScheduledBufferPlayer(context, gain, {
        onConsumed: (frames) => this.handleConsumedFrames(frames),
        onUnderrun: () => this.handleUnderrun(),
      });
    }
    try {
      await withTimeout(context.resume(), this.options.startupTimeoutMs ?? 10_000, "AudioContext resume timed out");
    } catch (error) {
      node?.disconnect();
      this.scheduledPlayer?.clear();
      this.scheduledPlayer = null;
      gain.disconnect();
      await context.close();
      throw error;
    }
    this.context = context;
    this.node = node;
    this.gain = gain;
  }

  enqueue(
    pcm: Int16Array | Float32Array,
    sourceRate: number,
    sourceStart: bigint,
    sourceEnd: bigint,
  ): void {
    if (!this.context || (!this.node && !this.scheduledPlayer)) {
      throw new Error("Audio player has not been started");
    }
    if (sourceEnd - sourceStart !== BigInt(pcm.length)) {
      throw new RangeError("PCM length does not match source sample cursor");
    }
    if (!this.resampler || this.sourceRate !== sourceRate) {
      if (this.cursors.queuedOutputFrames() > 0) {
        throw new Error("Cannot change source sample rate while audio is queued");
      }
      this.sourceRate = sourceRate;
      this.resampler = new ContinuousResampler(sourceRate, this.context.sampleRate);
      this.sourceBase = sourceStart;
      this.receivedThrough = sourceStart;
      this.cursors.clear(sourceStart);
    }
    if (sourceStart !== this.receivedThrough) {
      throw new RangeError("PCM source sample cursor is not contiguous");
    }
    this.receivedThrough = sourceEnd;
    const output = this.resampler.process(
      pcm instanceof Int16Array ? pcm16ToFloat32(pcm) : validateFloat32Pcm(pcm),
    );
    const maxFrames = this.maximumQueuedFrames();
    if (this.cursors.queuedOutputFrames() + output.length > maxFrames) {
      throw new AudioQueueOverflowError("Browser audio playback queue is full");
    }
    if (output.length === 0) return;
    const cursor = this.cursors.snapshot().bufferedThroughSample;
    const safeEnd = this.sourceBase + BigInt(this.resampler.consumedSourceFrames());
    this.cursors.push(output.length, cursor, safeEnd);
    this.pushOutput(output);
  }

  async pause(): Promise<void> {
    if (!this.context || this.paused) return;
    this.paused = true;
    this.node?.port.postMessage({type: "pause"});
    await this.context.suspend();
  }

  flush(): void {
    if ((!this.node && !this.scheduledPlayer) || !this.resampler) return;
    const output = this.resampler.flush();
    if (output.length === 0) return;
    if (this.cursors.queuedOutputFrames() + output.length > this.maximumQueuedFrames()) {
      throw new AudioQueueOverflowError("Browser audio playback queue is full");
    }
    const cursor = this.cursors.snapshot().bufferedThroughSample;
    const safeEnd = this.sourceBase + BigInt(this.resampler.consumedSourceFrames());
    if (safeEnd !== this.receivedThrough) {
      throw new Error("Resampler flush did not consume the complete source stream");
    }
    this.cursors.push(output.length, cursor, safeEnd);
    this.pushOutput(output);
  }

  async resume(): Promise<void> {
    if (!this.context) return;
    this.paused = false;
    this.node?.port.postMessage({type: "resume"});
    await this.context.resume();
  }

  clear(): void {
    this.node?.port.postMessage({type: "clear"});
    this.scheduledPlayer?.clear();
    this.resampler?.reset();
    this.cursors.clear();
    this.sourceRate = 0;
    this.sourceBase = 0n;
    this.receivedThrough = 0n;
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("Volume must be between 0 and 1");
    }
    if (this.gain && this.context) {
      this.gain.gain.setValueAtTime(value, this.context.currentTime);
    }
  }

  async setOutputDevice(deviceId: string): Promise<boolean> {
    if (!this.context) return false;
    const context = this.context as AudioContext & {
      setSinkId?: (sinkId: string) => Promise<void>;
    };
    if (!context.setSinkId) return false;
    await context.setSinkId(deviceId);
    return true;
  }

  supportsOutputDeviceSelection(): boolean {
    return typeof (this.context as (AudioContext & {setSinkId?: unknown}) | null)?.setSinkId === "function";
  }

  snapshot(): AudioPlayerSnapshot {
    const cursor = this.cursors.snapshot();
    return {
      sampleRate: this.context?.sampleRate ?? 0,
      queuedFrames: this.cursors.queuedOutputFrames(),
      playedThroughSample: cursor.playedThroughSample,
      bufferedThroughSample: cursor.bufferedThroughSample,
      underruns: this.underruns,
      paused: this.paused,
      backend: this.node
        ? "audio-worklet"
        : this.scheduledPlayer
          ? "scheduled-buffer"
          : null,
    };
  }

  async close(): Promise<void> {
    this.clear();
    this.node?.disconnect();
    this.scheduledPlayer = null;
    this.gain?.disconnect();
    this.node = null;
    this.gain = null;
    if (this.context) await this.context.close();
    this.context = null;
  }

  private handleWorkletMessage(message: MessageEvent): void {
    const payload = message.data as {type?: string; frames?: number};
    if (payload.type === "consumed") {
      this.handleConsumedFrames(payload.frames ?? 0);
    } else if (payload.type === "underrun") {
      this.handleUnderrun();
    } else if (payload.type === "overflow") {
      this.options.onError?.(new AudioQueueOverflowError("AudioWorklet playback queue overflowed"));
    }
  }

  private async createWorkletNode(
    context: AudioContext,
    gain: GainNode,
  ): Promise<AudioWorkletNode> {
    const worklet = context.audioWorklet as AudioWorklet | undefined;
    if (!worklet || typeof globalThis.AudioWorkletNode !== "function") {
      throw new Error(
        "AudioWorklet is unavailable in this browser context; using scheduled audio fallback",
      );
    }
    const configuredModule = this.options.workletModuleUrl;
    const ownedModuleUrl = configuredModule ? "" : URL.createObjectURL(
      new Blob([PCM_PLAYER_WORKLET_SOURCE], {type: "text/javascript"}),
    );
    const moduleUrl = configuredModule?.toString() || ownedModuleUrl;
    try {
      await withTimeout(
        worklet.addModule(moduleUrl),
        this.options.startupTimeoutMs ?? 10_000,
        "AudioWorklet startup timed out",
      );
    } finally {
      if (ownedModuleUrl) URL.revokeObjectURL(ownedModuleUrl);
    }
    const node = new AudioWorkletNode(context, "qwen3tts-pcm-player", {
      outputChannelCount: [1],
      processorOptions: {maxQueuedFrames: this.maximumQueuedFrames(context.sampleRate)},
    });
    node.connect(gain);
    node.port.onmessage = (message) => this.handleWorkletMessage(message);
    return node;
  }

  private pushOutput(output: Float32Array): void {
    if (this.node) {
      const transferable = output.buffer as ArrayBuffer;
      this.node.port.postMessage(
        {type: "push", samples: transferable},
        [transferable],
      );
      return;
    }
    this.scheduledPlayer?.push(output);
  }

  private handleConsumedFrames(frames: number): void {
    const cursor = this.cursors.consume(frames);
    this.options.onPlaybackProgress?.(
      cursor.playedThroughSample,
      cursor.bufferedThroughSample,
    );
  }

  private handleUnderrun(): void {
    this.underruns += 1;
    this.options.onUnderrun?.();
  }

  private maximumQueuedFrames(sampleRate = this.context?.sampleRate ?? 0): number {
    if (sampleRate <= 0) return 0;
    return Math.floor(
      sampleRate * this.maxBufferMs / 1_000,
    );
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function validateFloat32Pcm(samples: Float32Array): Float32Array {
  const copy = samples.slice();
  for (const sample of copy) {
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) {
      throw new RangeError("Float32 PCM samples must be finite values between -1 and 1");
    }
  }
  return copy;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
