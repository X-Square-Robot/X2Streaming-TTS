import {
  discoverCapabilities,
  parseCapabilities,
  REQUIRED_REALTIME_EXTENSIONS,
} from "./capabilities.js";
import type {Capabilities, SynthesisOptions, TTSEvent} from "./types.js";
import {AudioEncoding, DeliveryPolicy, InputMode, VadStrategy} from "./types.js";
import {toWebSocketUrl} from "./urls.js";
import {parseRealtimeServerEvent} from "./realtime-contract.js";
import {createUuidV4} from "./random-id.js";

export enum ClientState {
  Idle = "idle",
  Connecting = "connecting",
  Ready = "ready",
  Responding = "responding",
  Closed = "closed",
}

export interface WebSocketLike {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;
export type EventListener = (event: TTSEvent) => void;
export type RawEventListener = (event: Record<string, unknown>) => void;

export interface RealtimeTTSClientOptions {
  capabilitiesUrl: URL | string;
  websocketUrl?: URL | string;
  model?: string;
  /**
   * Reuse a capabilities snapshot that was already discovered by the host
   * application. This is especially useful for a browser-side concurrency
   * probe, where every lane otherwise performs the same HTTP request.
   */
  capabilities?: Capabilities;
  fetcher?: typeof fetch;
  webSocketFactory?: WebSocketFactory;
  connectTimeoutMs?: number;
  resumeAttempts?: number;
}

export interface SynthesisRun {
  readonly done: Promise<TTSEvent>;
  cancel(): void;
  acknowledgePlayback(playedThroughSample: bigint, bufferedThroughSample?: bigint): void;
}

export interface IncrementalSynthesisRun extends SynthesisRun {
  append(text: string): number;
  commit(): void;
}

export interface ClientDiagnosticSnapshot {
  readonly state: ClientState;
  readonly responseId: string;
  readonly receivedThroughSample: bigint;
  readonly lastDeliverySequence: number;
  readonly recovering: boolean;
}

type PendingWaiter = {
  resolve: (event: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RealtimeTTSClient {
  readonly options: RealtimeTTSClientOptions;
  state = ClientState.Idle;
  capabilities: Capabilities | null = null;

  private socket: WebSocketLike | null = null;
  private readonly listeners = new Set<EventListener>();
  private readonly rawListeners = new Set<RawEventListener>();
  private readonly waiters = new Map<string, PendingWaiter[]>();
  private active: ActiveResponse | null = null;
  private lastDeliverySequence = 0;
  private websocketEndpoint = "";
  private lastSessionUpdate: Record<string, unknown> | null = null;
  private recovering = false;
  private lastResponseId = "";
  private lastReceivedThroughSample = 0n;

  constructor(options: RealtimeTTSClientOptions) {
    this.options = options;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRawEvent(listener: RawEventListener): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  snapshot(): ClientDiagnosticSnapshot {
    return {
      state: this.state,
      responseId: this.active?.responseId ?? this.lastResponseId,
      receivedThroughSample: this.active?.sampleCursor ?? this.lastReceivedThroughSample,
      lastDeliverySequence: this.lastDeliverySequence,
      recovering: this.recovering,
    };
  }

  async connect(): Promise<void> {
    if (this.state === ClientState.Ready) return;
    if (this.state !== ClientState.Idle) {
      throw new Error(`Cannot connect a client in ${this.state} state`);
    }
    this.state = ClientState.Connecting;
    try {
      this.capabilities = this.options.capabilities ?? await discoverCapabilities(
        this.options.capabilitiesUrl,
        this.options.fetcher,
      );
      const realtime = this.capabilities.protocols.openai_realtime;
      const endpoint = this.options.websocketUrl ?? new URL(
        realtime.path.replace(/^\//, ""),
        ensureDirectoryUrl(this.options.capabilitiesUrl),
      );
      this.websocketEndpoint = toWebSocketUrl(endpoint).toString();
      const socketFactory = this.options.webSocketFactory ?? ((url) => new WebSocket(url));
      this.socket = socketFactory(this.websocketEndpoint);
      this.socket.binaryType = "arraybuffer";
      this.installSocketHandlers(this.socket);
      const created = this.waitFor("session.created");
      await this.waitForOpen(this.socket);
      await created;
      this.state = ClientState.Ready;
      this.emit({type: "connected"});
    } catch (error) {
      this.state = ClientState.Idle;
      this.socket?.close();
      this.socket = null;
      this.rejectWaiters(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<SynthesisRun> {
    if (!text.trim()) throw new TypeError("Synthesis text must not be empty");
    await this.prepareResponse(options);
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{type: "input_text", text}],
      },
    });
    return this.createResponse(false);
  }

  async startIncremental(options: SynthesisOptions): Promise<IncrementalSynthesisRun> {
    await this.prepareResponse(options);
    return this.createResponse(true) as IncrementalSynthesisRun;
  }

  close(): void {
    if (this.state === ClientState.Closed) return;
    const active = this.active;
    if (active) {
      try {
        active.cancel();
      } catch {
        // The transport may already be gone. The local run still needs a
        // terminal result so callers never wait forever on run.done.
      }
      this.finishActive(
        {type: "cancelled", responseId: active.responseId},
        ClientState.Closed,
      );
    }
    this.socket?.close(1000, "client closed");
    this.socket = null;
    this.rejectWaiters(new Error("Realtime client closed"));
    this.state = ClientState.Closed;
  }

  private async prepareResponse(options: SynthesisOptions): Promise<void> {
    if (this.state !== ClientState.Ready || !this.socket || !this.capabilities) {
      throw new Error("Realtime client is not connected or another response is active");
    }
    validateOptions(this.capabilities, options);
    const updated = this.waitFor("session.updated");
    this.lastSessionUpdate = sessionUpdate(
      options,
      this.options.model ?? this.capabilities.model ?? "",
    );
    this.send(this.lastSessionUpdate);
    await updated;
  }

  private createResponse(incremental: boolean): SynthesisRun | IncrementalSynthesisRun {
    this.state = ClientState.Responding;
    this.lastDeliverySequence = 0;
    this.lastResponseId = "";
    this.lastReceivedThroughSample = 0n;
    const active = new ActiveResponse(this, incremental);
    this.active = active;
    this.send({
      type: "response.create",
      response: {metadata: {qwen_resume_token: active.resumeToken}},
    });
    return active;
  }

  send(payload: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Realtime WebSocket is not connected");
    this.socket.send(JSON.stringify(payload));
  }

  private installSocketHandlers(socket: WebSocketLike): void {
    socket.onmessage = (message) => {
      if (typeof message.data !== "string") return;
      let event: unknown;
      try {
        event = JSON.parse(message.data);
      } catch {
        this.emit({type: "error", code: "invalid_json", message: "Invalid server JSON"});
        return;
      }
      try {
        event = parseRealtimeServerEvent(event);
      } catch (error) {
        this.emit({type: "error", code: "invalid_event", message: String(error)});
        return;
      }
      if (!isRecord(event) || typeof event.type !== "string") return;
      for (const listener of this.rawListeners) listener(event);
      this.resolveWaiter(event.type, event);
      this.handleResponseEvent(event);
    };
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      if (this.state !== ClientState.Closed) {
        const code = Number(event.code || 0);
        const reason = String(event.reason || "").trim();
        const detail = code || reason
          ? ` (${code || "unknown"}${reason ? `: ${reason}` : ""})`
          : "";
        this.rejectWaiters(new Error(`Realtime WebSocket closed${detail}`));
        this.socket = null;
        if (this.active && this.state === ClientState.Responding) {
          if (this.lastSessionUpdate && (this.options.resumeAttempts ?? 3) > 0) {
            void this.recoverActiveResponse();
          } else {
            this.finishActive(
              {
                type: "error",
                code: "websocket_closed",
                message: `Realtime WebSocket closed${detail}`,
              },
              ClientState.Idle,
            );
          }
        } else {
          this.state = ClientState.Idle;
        }
      }
    };
  }

  private handleResponseEvent(event: Record<string, unknown>): void {
    const type = String(event.type);
    if (type === "error") {
      const error = record(event.error);
      const code = String(error.code ?? "realtime_error");
      const message = String(error.message ?? "Realtime request failed");
      if (this.active) {
        this.failActive(code, message);
      } else {
        this.emit({type: "warning", message});
      }
      return;
    }
    if (!this.active) return;
    if (type === "response.created") {
      const response = record(event.response);
      const responseId = String(response.id ?? "");
      if (this.active.responseId === responseId) return;
      this.active.responseId = responseId;
      this.emit({type: "response_started", responseId: this.active.responseId});
      return;
    }
    if (type === "qwen.input_text_buffer.ack") {
      this.active.acceptSequence(Number(event.sequence ?? 0));
      return;
    }
    if (type === "response.output_audio.delta") {
      this.trackDelivery(event);
      const bytes = decodeBase64(String(event.delta ?? ""));
      const start = toBigInt(event.qwen_output_sample_start, this.active.sampleCursor);
      const end = toBigInt(event.qwen_output_sample_end, start + BigInt(bytes.length / 2));
      if (start !== this.active.sampleCursor || end !== start + BigInt(bytes.length / 2)) {
        this.failActive("non_contiguous_audio", "Realtime audio sample cursor is not contiguous");
        return;
      }
      this.active.sampleCursor = end;
      const server = serverDiagnostics({qwen_server_ttft_ms: event.qwen_server_ttft_ms});
      this.emit({
        type: "audio",
        pcm: pcm16(bytes),
        startSample: start,
        endSample: end,
        ...(server === undefined ? {} : {server}),
      });
      return;
    }
    if (type === "qwen.text_progress") {
      this.trackDelivery(event);
      const meta = record(event.meta);
      const sample = toBigInt(meta.output_sample_end, this.active.sampleCursor);
      this.emit({type: "progress", text: String(event.text ?? ""), sample, meta});
      return;
    }
    if (type !== "response.done") return;
    this.trackDelivery(event);
    const response = record(event.response);
    const responseId = String(response.id ?? this.active.responseId);
    const status = String(response.status ?? "completed");
    const usage = numericRecord(response.usage);
    const server = serverDiagnostics(record(response.metadata));
    const terminal: TTSEvent = status === "cancelled"
      ? {type: "cancelled", responseId}
      : status === "failed"
        ? {
            type: "error",
            code: String(record(record(response.status_details).error).code ?? "response_failed"),
            message: String(
              record(record(response.status_details).error).message ?? "Synthesis failed",
            ),
          }
        : usage === undefined && server === undefined
          ? {type: "completed", responseId}
          : {
              type: "completed",
              responseId,
              ...(usage === undefined ? {} : {usage}),
              ...(server === undefined ? {} : {server}),
            };
    this.send({
      type: "qwen.response.terminal_ack",
      resume_token: this.active.resumeToken,
      through_delivery_seq: this.lastDeliverySequence,
      audio_through_sample: this.active.sampleCursor.toString(),
    });
    this.finishActive(terminal);
  }

  private trackDelivery(event: Record<string, unknown>): void {
    const sequence = Number(event.qwen_delivery_seq ?? 0);
    if (sequence > 0) this.lastDeliverySequence = Math.max(this.lastDeliverySequence, sequence);
  }

  private finishActive(event: TTSEvent, nextState: ClientState = ClientState.Ready): void {
    const active = this.active;
    if (!active) return;
    this.lastResponseId = active.responseId;
    this.lastReceivedThroughSample = active.sampleCursor;
    this.active = null;
    this.state = nextState;
    active.resolve(event);
    this.emit(event);
  }

  private failActive(code: string, message: string): void {
    if (!this.active) return;
    this.finishActive({type: "error", code, message});
  }

  private async recoverActiveResponse(): Promise<void> {
    if (this.recovering || !this.active) return;
    if (!this.lastSessionUpdate) {
      this.finishActive(
        {
          type: "error",
          code: "websocket_closed",
          message: "Realtime WebSocket closed before response recovery was possible",
        },
        ClientState.Idle,
      );
      return;
    }
    this.recovering = true;
    let lastError: unknown = new Error("Realtime WebSocket closed");
    const attempts = Math.max(0, this.options.resumeAttempts ?? 3);
    try {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        this.emit({type: "reconnecting", attempt});
        try {
          await new Promise((resolve) => setTimeout(resolve, Math.min(500, 50 * 2 ** (attempt - 1))));
          const socketFactory = this.options.webSocketFactory ?? ((url) => new WebSocket(url));
          const socket = socketFactory(this.websocketEndpoint);
          socket.binaryType = "arraybuffer";
          this.socket = socket;
          this.installSocketHandlers(socket);
          const created = this.waitFor("session.created");
          await this.waitForOpen(socket);
          await created;
          const updated = this.waitFor("session.updated");
          this.send(this.lastSessionUpdate);
          await updated;
          const resumed = this.waitFor("qwen.response.resumed");
          this.send({
            type: "qwen.response.resume",
            resume_token: this.active.resumeToken,
            last_delivery_seq: this.lastDeliverySequence,
            audio_through_sample: this.active.sampleCursor.toString(),
          });
          const resumedEvent = await resumed;
          this.active.replayAfterResume(
            Number(resumedEvent.acked_text_seq ?? 0),
            Boolean(resumedEvent.input_closed),
          );
          return;
        } catch (error) {
          lastError = error;
          this.socket?.close();
          this.socket = null;
          this.rejectWaiters(error instanceof Error ? error : new Error(String(error)));
        }
      }
      this.finishActive(
        {
          type: "error",
          code: "resume_failed",
          message: `Realtime response resume failed: ${String(lastError)}`,
        },
        ClientState.Idle,
      );
    } finally {
      this.recovering = false;
    }
  }

  private emit(event: TTSEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private waitFor(type: string): Promise<Record<string, unknown>> {
    const timeout = this.options.connectTimeoutMs ?? 10_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeWaiter(type, waiter);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeout);
      const waiter = {resolve, reject, timer};
      const queue = this.waiters.get(type) ?? [];
      queue.push(waiter);
      this.waiters.set(type, queue);
    });
  }

  private resolveWaiter(type: string, event: Record<string, unknown>): void {
    const waiter = this.waiters.get(type)?.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (this.waiters.get(type)?.length === 0) this.waiters.delete(type);
    waiter.resolve(event);
  }

  private removeWaiter(type: string, waiter: PendingWaiter): void {
    const queue = this.waiters.get(type);
    if (!queue) return;
    const index = queue.indexOf(waiter);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.waiters.delete(type);
  }

  private rejectWaiters(error: Error): void {
    for (const queue of this.waiters.values()) {
      for (const waiter of queue) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.waiters.clear();
  }

  private waitForOpen(socket: WebSocketLike): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out opening Realtime WebSocket")),
        this.options.connectTimeoutMs ?? 10_000,
      );
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  playbackAck(responseId: string, played: bigint, buffered: bigint): void {
    this.send({
      type: "qwen.playback.ack",
      response_id: responseId,
      played_through_sample: played.toString(),
      buffered_through_sample: buffered.toString(),
      observed_delivery_seq: this.lastDeliverySequence,
      client_monotonic_ms: Math.round(performance.now()),
    });
  }
}

class ActiveResponse implements IncrementalSynthesisRun {
  readonly done: Promise<TTSEvent>;
  responseId = "";
  sampleCursor = 0n;
  readonly resumeToken = createUuidV4();
  private nextSequence = 1;
  private acceptedSequence = 0;
  private inputClosed = false;
  private commitSent = false;
  private readonly journal = new Map<number, Record<string, unknown>>();
  private readonly incremental: boolean;
  private resolveDone!: (event: TTSEvent) => void;

  constructor(private readonly client: RealtimeTTSClient, incremental: boolean) {
    this.incremental = incremental;
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  append(text: string): number {
    if (!this.incremental) throw new Error("This is not an incremental response");
    if (this.inputClosed) throw new Error("Incremental input is already closed");
    if (!text) throw new TypeError("Incremental text must not be empty");
    const sequence = this.nextSequence++;
    const payload = {type: "qwen.input_text_buffer.append", sequence, text};
    this.journal.set(sequence, payload);
    this.client.send(payload);
    return sequence;
  }

  commit(): void {
    if (!this.incremental) throw new Error("This is not an incremental response");
    if (this.inputClosed) return;
    this.inputClosed = true;
    this.commitSent = true;
    this.client.send({type: "qwen.input_text_buffer.commit"});
  }

  cancel(): void {
    this.inputClosed = true;
    this.client.send({type: "response.cancel"});
  }

  acknowledgePlayback(playedThroughSample: bigint, bufferedThroughSample = playedThroughSample): void {
    if (!this.responseId) return;
    this.client.playbackAck(this.responseId, playedThroughSample, bufferedThroughSample);
  }

  acceptSequence(sequence: number): void {
    if (sequence < this.acceptedSequence || sequence >= this.nextSequence) {
      throw new RangeError("Text ACK is outside the sent sequence range");
    }
    this.acceptedSequence = sequence;
    for (const sentSequence of this.journal.keys()) {
      if (sentSequence <= sequence) this.journal.delete(sentSequence);
    }
  }

  replayAfterResume(ackedSequence: number, serverInputClosed: boolean): void {
    if (ackedSequence < this.acceptedSequence || ackedSequence >= this.nextSequence) {
      throw new RangeError("Resumed text ACK is outside the sent sequence range");
    }
    this.acceptSequence(ackedSequence);
    for (const payload of this.journal.values()) this.client.send(payload);
    if (this.commitSent && !serverInputClosed) {
      this.client.send({type: "qwen.input_text_buffer.commit"});
    }
  }

  resolve(event: TTSEvent): void {
    this.resolveDone(event);
  }
}

function sessionUpdate(options: SynthesisOptions, model: string): Record<string, unknown> {
  const audio = options.audio ?? {
    encoding: AudioEncoding.PcmS16Le,
    sample_rate: 24000,
    channels: 1 as const,
  };
  const output = options.outputPolicy ?? {};
  const delivery = output.delivery ?? options.delivery ?? DeliveryPolicy.Guarded;
  const qwen: Record<string, unknown> = {
    task_type: options.task,
    language: options.language ?? "auto",
    speaker: options.speaker,
    instruct: options.instruct,
    ref_audio: options.reference?.audioBase64,
    ref_text: options.reference?.text,
    x_vector_only: options.reference?.xVectorOnly,
    input_mode: options.inputMode ?? InputMode.FullText,
    output_policy: {
      vad_policy: options.vad ?? {enabled: false, strategy: VadStrategy.Disabled},
      ...(output.chunk_ms === undefined ? {} : {chunk_ms: output.chunk_ms}),
      ...(output.emit_text_events === undefined ? {} : {emit_text_events: output.emit_text_events}),
      config: {
        delivery,
        ...(output.delivery_window_ms === undefined ? {} : {delivery_window_ms: output.delivery_window_ms}),
      },
    },
    timing: options.timing,
  };
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model,
      instructions: options.instruct ?? "",
      output_modalities: ["audio"],
      audio: {
        output: {
          format: {type: "audio/pcm", rate: audio.sample_rate},
          voice: options.speaker ?? null,
        },
      },
      qwen: Object.fromEntries(Object.entries(qwen).filter(([, value]) => value !== undefined)),
    },
  };
}

function validateOptions(capabilities: Capabilities, options: SynthesisOptions): void {
  if (!capabilities.tasks.includes(options.task)) {
    throw new RangeError(`Task ${options.task} is not advertised by this instance`);
  }
  if (options.reference && !capabilities.reference.available) {
    throw new RangeError(`Reference audio is unavailable: ${capabilities.reference.reason}`);
  }
  if (options.reference && options.reference.audioBase64.length === 0) {
    throw new RangeError("Reference audio must not be empty");
  }
  if (options.reference) {
    const referenceBytes = decodedBase64Length(options.reference.audioBase64);
    if (referenceBytes > capabilities.reference.max_bytes) {
      throw new RangeError(`Reference audio exceeds the advertised ${capabilities.reference.max_bytes}-byte limit`);
    }
    if (capabilities.reference.mime_types.every((value) => value === "audio/wav" || value === "audio/x-wav")
      && !base64HasRiffWaveHeader(options.reference.audioBase64)) {
      throw new RangeError("Reference audio must be an advertised RIFF/WAV file");
    }
  }
  if (options.reference?.xVectorOnly && !capabilities.reference.speaker_encoder_available) {
    throw new RangeError("x-vector reference cloning is not advertised by this instance");
  }
  if (options.reference && !options.reference.xVectorOnly && !capabilities.reference.icl_available) {
    throw new RangeError("ICL reference cloning is not advertised by this instance");
  }
  if (options.speaker && capabilities.speakers?.length && !capabilities.speakers.includes(options.speaker)) {
    throw new RangeError(`Speaker ${options.speaker} is not advertised by this instance`);
  }
  if (options.language && capabilities.languages?.length && !capabilities.languages.includes(options.language)) {
    throw new RangeError(`Language ${options.language} is not advertised by this instance`);
  }
  const strategy = options.vad?.strategy ?? VadStrategy.Disabled;
  if (!capabilities.output_policy.vad_strategies.includes(strategy)) {
    throw new RangeError(`VAD strategy ${strategy} is not advertised by this instance`);
  }
  const audio = options.audio;
  if (audio && !capabilities.audio_formats.some((format) =>
    format.encoding === audio.encoding && format.sample_rate === audio.sample_rate && format.channels === audio.channels
  )) {
    throw new RangeError(`Audio format ${audio.encoding}/${audio.sample_rate}Hz is not advertised by this instance`);
  }
  if (audio && !capabilities.protocols.openai_realtime.audio_formats.includes(audio.encoding)) {
    throw new RangeError(`Audio encoding ${audio.encoding} is not supported by the Realtime endpoint`);
  }
  if (options.inputMode && capabilities.input_modes
    && !capabilities.input_modes.includes(options.inputMode)) {
    throw new RangeError(`Input mode ${options.inputMode} is not advertised by this instance`);
  }
  validateVad(options.vad);
  validateTiming(options.timing);
  const output = options.outputPolicy;
  if (output?.chunk_ms !== undefined) requireRange("outputPolicy.chunk_ms", output.chunk_ms, 0, 10_000, true);
  if (output?.delivery_window_ms !== undefined) requireRange("outputPolicy.delivery_window_ms", output.delivery_window_ms, 100, 10_000, true);
  if (output?.chunk_ms !== undefined && !capabilities.output_policy.features.includes("chunk_ms")) {
    throw new RangeError("Output chunk_ms is not advertised by this instance");
  }
  if (output?.emit_text_events !== undefined && !capabilities.output_policy.features.includes("emit_text_events")) {
    throw new RangeError("Text progress events are not advertised by this instance");
  }
  if ((output?.delivery ?? options.delivery) === DeliveryPolicy.Guarded
    && !capabilities.output_policy.features.includes("guarded_delivery")) {
    throw new RangeError("Guarded delivery is not advertised by this instance");
  }
}

function validateTiming(timing: SynthesisOptions["timing"]): void {
  if (!timing) return;
  for (const [name, value] of Object.entries({
    client_request_ts_ms: timing.client_request_ts_ms,
    client_text_ts_ms: timing.client_text_ts_ms,
    client_end_ts_ms: timing.client_end_ts_ms,
  })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`timing.${name} must be a non-negative safe integer`);
    }
  }
}

function validateVad(vad: SynthesisOptions["vad"]): void {
  if (!vad) return;
  if (vad.chunk_ms !== undefined) requireRange("vad.chunk_ms", vad.chunk_ms, 1, 1000, true);
  if (vad.begin_threshold !== undefined) requireRange("vad.begin_threshold", vad.begin_threshold, 0, 1);
  if (vad.end_threshold !== undefined) requireRange("vad.end_threshold", vad.end_threshold, 0, 1);
  if (vad.begin_count !== undefined) requireRange("vad.begin_count", vad.begin_count, 1, 1000, true);
  if (vad.end_count !== undefined) requireRange("vad.end_count", vad.end_count, 1, 1000, true);
  if (vad.start_margin_ms !== undefined) requireRange("vad.start_margin_ms", vad.start_margin_ms, 0, 10_000, true);
}

function requireRange(name: string, value: number, min: number, max: number, integer = false): void {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? "an integer " : ""}between ${min} and ${max}`);
  }
}

function ensureDirectoryUrl(source: URL | string): URL {
  const url = new URL(source);
  url.pathname = url.pathname.replace(/\/v1\/capabilities$/, "/");
  return url;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodedBase64Length(value: string): number {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new RangeError("Reference audio must be valid base64");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

function base64HasRiffWaveHeader(value: string): boolean {
  if (value.length < 16) return false;
  const bytes = decodeBase64(value.slice(0, 16));
  return String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE";
}

function pcm16(bytes: Uint8Array): Int16Array {
  if (bytes.byteLength % 2 !== 0) throw new TypeError("PCM16 delta has an odd byte length");
  const copy = bytes.slice();
  return new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2);
}

function serverDiagnostics(metadata: Record<string, unknown>) {
  const ttft = optionalFinite(metadata.qwen_server_ttft_ms);
  const total = optionalFinite(metadata.qwen_server_total_ms);
  const queueWait = optionalFinite(metadata.server_engine_queue_wait_ms);
  const prefill = optionalFinite(metadata.server_engine_prefill_ms);
  const dequeueToRaw = optionalFinite(metadata.server_first_text_dequeue_to_first_raw_audio_ms);
  const rawToEffective = optionalFinite(metadata.server_first_raw_to_first_effective_audio_ms);
  const trimmed = optionalFinite(metadata.server_prefix_trimmed_ms);
  const applied = optionalBoolean(metadata.server_prefix_trim_applied);
  const strategy = typeof metadata.vad_strategy === "string" ? metadata.vad_strategy : undefined;
  if (ttft === undefined && total === undefined && queueWait === undefined && prefill === undefined
    && dequeueToRaw === undefined && rawToEffective === undefined
    && trimmed === undefined && applied === undefined && strategy === undefined) return undefined;
  return {
    ...(ttft === undefined ? {} : {ttft_ms: ttft}),
    ...(total === undefined ? {} : {total_ms: total}),
    ...(queueWait === undefined ? {} : {engine_queue_wait_ms: queueWait}),
    ...(prefill === undefined ? {} : {engine_prefill_ms: prefill}),
    ...(dequeueToRaw === undefined ? {} : {first_text_dequeue_to_first_raw_audio_ms: dequeueToRaw}),
    ...(rawToEffective === undefined ? {} : {first_raw_to_first_effective_audio_ms: rawToEffective}),
    ...(trimmed === undefined ? {} : {prefix_trimmed_ms: trimmed}),
    ...(applied === undefined ? {} : {prefix_trim_applied: applied}),
    ...(strategy === undefined ? {} : {vad_strategy: strategy}),
  };
}

function optionalFinite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toBigInt(value: unknown, fallback: bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return fallback;
}

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

export {parseCapabilities, REQUIRED_REALTIME_EXTENSIONS};
