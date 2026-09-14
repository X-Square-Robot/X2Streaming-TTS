import {readFileSync} from "node:fs";

import {describe, expect, it} from "vitest";

import {RealtimeTTSClient, type WebSocketLike} from "./realtime-client.js";
import {AudioEncoding, DeliveryPolicy, SynthesisTask, VadStrategy} from "./types.js";
import {REQUIRED_REALTIME_EXTENSIONS} from "./capabilities.js";

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
    this.receive({type: "session.created", session: {id: "sess_1"}});
  }

  send(data: string): void {
    const event = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(event);
    if (event.type === "session.update") {
      this.receive({type: "session.updated", session: {id: "sess_1"}});
    } else if (event.type === "response.create") {
      this.receive({type: "response.created", response: {id: "resp_1"}});
    } else if (event.type === "qwen.response.resume") {
      this.receive({
        type: "qwen.response.resumed",
        response_id: "resp_1",
        acked_text_seq: 0,
        input_closed: false,
      });
      this.receive({type: "response.created", response: {id: "resp_1"}});
    }
  }

  close(): void {
    this.readyState = 3;
  }

  disconnect(): void {
    this.readyState = 3;
    this.onclose?.({code: 1006} as CloseEvent);
  }

  receive(event: Record<string, unknown>): void {
    queueMicrotask(() => this.onmessage?.({data: JSON.stringify(event)} as MessageEvent));
  }
}

const capabilities = {
  schema_version: "qwen.tts.capabilities.v1",
  model: "custom-1.7b",
  tasks: ["custom_voice"],
  task_status: [{task: "custom_voice", available: true, stability: "stable"}],
  audio_formats: [{encoding: "pcm_s16le", sample_rate: 24000, channels: 1}],
  output_policy: {
    features: ["vad_policy", "guarded_delivery", "chunk_ms", "emit_text_events"],
    vad_strategies: ["disabled", "energy"],
  },
  limits: {max_input_tokens: 128, max_realtime_message_bytes: 8_388_608},
  reference: {available: false, max_duration_sec: 0, max_bytes: 4_194_304, mime_types: ["audio/wav"], reason: "not loaded"},
  protocols: {
    openai_realtime: {
      path: "/v1/realtime",
      base: "openai-realtime-v1",
      extension_protocol: "qwen-realtime-v1",
      supported_extensions: [...REQUIRED_REALTIME_EXTENSIONS],
      features: ["active_response_resume"],
      audio_formats: ["pcm_s16le"],
    },
  },
};

function setup() {
  const socket = new FakeWebSocket();
  const client = new RealtimeTTSClient({
    capabilitiesUrl: "https://host/infer/id/v1/capabilities",
    fetcher: async () => new Response(JSON.stringify(capabilities)),
    webSocketFactory: (url) => {
      expect(url).toBe("wss://host/infer/id/v1/realtime");
      queueMicrotask(() => socket.open());
      return socket;
    },
  });
  return {client, socket};
}

const options = {
  task: SynthesisTask.CustomVoice,
  speaker: "Serena",
  audio: {encoding: AudioEncoding.PcmS16Le, sample_rate: 24000, channels: 1 as const},
  vad: {enabled: false, strategy: VadStrategy.Disabled},
  timing: {request_id: "golden-request", client_request_ts_ms: 123456},
};

describe("RealtimeTTSClient", () => {
  it("reuses a supplied capabilities snapshot without fetching it again", async () => {
    const socket = new FakeWebSocket();
    let fetches = 0;
    const client = new RealtimeTTSClient({
      capabilitiesUrl: "https://host/infer/id/v1/capabilities",
      capabilities: capabilities as any,
      fetcher: async () => {
        fetches += 1;
        return new Response(JSON.stringify(capabilities));
      },
      webSocketFactory: (url) => {
        expect(url).toBe("wss://host/infer/id/v1/realtime");
        queueMicrotask(() => socket.open());
        return socket;
      },
    });

    await client.connect();

    expect(fetches).toBe(0);
    expect(client.capabilities).toEqual(capabilities);
  });

  it("matches the Python SDK golden session core", async () => {
    const golden = JSON.parse(readFileSync(new URL(
      "./fixtures/realtime-session-core.json",
      import.meta.url,
    ), "utf8")) as Record<string, unknown>;
    const {client, socket} = setup();
    await client.connect();
    await client.synthesize("你好", options);
    const session = socket.sent[0]?.session as Record<string, any>;
    expect({
      model: session.model,
      task_type: session.qwen.task_type,
      speaker: session.audio.output.voice,
      input_mode: session.qwen.input_mode,
      sample_rate: session.audio.output.format.rate,
      audio_format: session.audio.output.format.type,
      vad_enabled: session.qwen.output_policy.vad_policy.enabled,
      vad_strategy: session.qwen.output_policy.vad_policy.strategy,
      delivery: session.qwen.output_policy.config.delivery,
      request_id: session.qwen.timing.request_id,
      client_request_ts_ms: session.qwen.timing.client_request_ts_ms,
    }).toEqual(golden);
  });

  it("runs full-text synthesis and decodes contiguous PCM16", async () => {
    const {client, socket} = setup();
    const events: string[] = [];
    let firstAudioServerTtft: number | undefined;
    client.onEvent((event) => {
      events.push(event.type);
      if (event.type === "audio") firstAudioServerTtft = event.server?.ttft_ms;
    });
    await client.connect();
    const run = await client.synthesize("你好", options);
    await Promise.resolve();

    expect(socket.sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "response.create",
    ]);
    expect(socket.sent[2]).toMatchObject({
      response: {metadata: {qwen_resume_token: expect.any(String)}},
    });
    socket.receive({
      type: "response.output_audio.delta",
      response_id: "resp_1",
      delta: btoa("\u0001\u0000\u0002\u0000"),
      qwen_delivery_seq: 1,
      qwen_output_sample_start: 0,
      qwen_output_sample_end: 2,
      qwen_server_ttft_ms: "12.5",
    });
    socket.receive({
      type: "response.done",
      qwen_delivery_seq: 2,
      response: {
        id: "resp_1",
        status: "completed",
        usage: {total_tokens: 3},
        metadata: {
          qwen_server_ttft_ms: "12.5",
          qwen_server_total_ms: "80",
          server_engine_queue_wait_ms: "4",
          server_engine_prefill_ms: "7.5",
          server_first_text_dequeue_to_first_raw_audio_ms: "18",
          server_first_raw_to_first_effective_audio_ms: "2",
          server_prefix_trimmed_ms: "16",
          server_prefix_trim_applied: "true",
          vad_strategy: "energy",
        },
      },
    });
    const terminal = await run.done;

    expect(firstAudioServerTtft).toBe(12.5);
    expect(terminal).toMatchObject({
      type: "completed",
      responseId: "resp_1",
      server: {
        ttft_ms: 12.5,
        total_ms: 80,
        engine_queue_wait_ms: 4,
        engine_prefill_ms: 7.5,
        first_text_dequeue_to_first_raw_audio_ms: 18,
        first_raw_to_first_effective_audio_ms: 2,
        prefix_trimmed_ms: 16,
        prefix_trim_applied: true,
        vad_strategy: "energy",
      },
    });
    expect(client.snapshot()).toMatchObject({state: "ready", responseId: "resp_1", receivedThroughSample: 2n, lastDeliverySequence: 2});
    expect(events).toEqual(["connected", "response_started", "audio", "completed"]);
    expect(socket.sent.at(-1)?.type).toBe("qwen.response.terminal_ack");
  });

  it("keeps progress basis metadata for native-versus-EMA routing", async () => {
    const {client, socket} = setup();
    const progress: unknown[] = [];
    client.onEvent((event) => {
      if (event.type === "progress") progress.push(event);
    });
    await client.connect();
    const run = await client.synthesize("你好", options);
    await Promise.resolve();
    socket.receive({
      type: "qwen.text_progress",
      text: "你好",
      meta: {
        output_sample_end: "24",
        progress_basis: "native_cursor_v1",
        progress_quality: "native",
      },
      qwen_delivery_seq: 1,
    });
    socket.receive({
      type: "response.done",
      qwen_delivery_seq: 2,
      response: {id: "resp_1", status: "completed"},
    });
    await run.done;
    expect(progress).toMatchObject([{
      type: "progress",
      meta: {progress_basis: "native_cursor_v1", progress_quality: "native"},
    }]);
  });

  it("uses contiguous incremental sequence numbers and playback ACK", async () => {
    const {client, socket} = setup();
    await client.connect();
    const run = await client.startIncremental(options);
    await Promise.resolve();
    expect(run.append("你")).toBe(1);
    expect(run.append("好")).toBe(2);
    run.commit();
    run.acknowledgePlayback(12n, 24n);

    expect(socket.sent.slice(-4).map((event) => event.type)).toEqual([
      "qwen.input_text_buffer.append",
      "qwen.input_text_buffer.append",
      "qwen.input_text_buffer.commit",
      "qwen.playback.ack",
    ]);
    expect(socket.sent.at(-1)).toMatchObject({
      response_id: "resp_1",
      played_through_sample: "12",
      buffered_through_sample: "24",
    });
  });

  it("settles an active response when the gateway returns a request error", async () => {
    const {client, socket} = setup();
    await client.connect();
    const run = await client.synthesize("hello", options);
    await Promise.resolve();

    socket.receive({
      type: "error",
      error: {code: "max_sessions", message: "Max sessions (128) reached"},
    });

    await expect(run.done).resolves.toMatchObject({
      type: "error",
      code: "max_sessions",
      message: "Max sessions (128) reached",
    });
    expect(client.snapshot().state).toBe("ready");
  });

  it("settles an active response when the client is closed", async () => {
    const {client} = setup();
    await client.connect();
    const run = await client.synthesize("hello", options);

    client.close();

    await expect(run.done).resolves.toMatchObject({
      type: "cancelled",
    });
    expect(client.snapshot().state).toBe("closed");
  });

  it("keeps an idle server error visible as a warning", async () => {
    const {client, socket} = setup();
    const warnings: string[] = [];
    client.onEvent((event) => {
      if (event.type === "warning") warnings.push(event.message);
    });
    await client.connect();

    socket.receive({
      type: "error",
      error: {code: "max_sessions", message: "Max sessions (128) reached"},
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnings).toEqual(["Max sessions (128) reached"]);
    expect(client.snapshot().state).toBe("ready");
  });

  it("rejects capabilities that do not advertise the requested VAD", async () => {
    const {client} = setup();
    await client.connect();
    await expect(
      client.synthesize("hello", {
        ...options,
        vad: {enabled: true, strategy: VadStrategy.TenVad},
      }),
    ).rejects.toThrow("not advertised");
  });

  it("serializes typed VAD, delivery, progress and reference settings", async () => {
    const referenceCapabilities = capabilities.reference;
    capabilities.reference = {
      ...referenceCapabilities,
      available: true,
      reason: "",
      speaker_encoder_available: true,
      icl_available: true,
    };
    const {client, socket} = setup();
    try {
      await client.connect();
      const run = await client.synthesize("hello", {
        ...options,
        reference: {audioBase64: "UklGRnh4eHhXQVZF", text: "hello", xVectorOnly: true},
        vad: {enabled: true, strategy: VadStrategy.Energy, begin_threshold: 0.7, end_count: 20},
        outputPolicy: {delivery: DeliveryPolicy.Guarded, delivery_window_ms: 180, chunk_ms: 40, emit_text_events: true},
        timing: {request_id: "browser-request-1", turn_id: "turn-1", client_request_ts_ms: 123},
      });
      expect(socket.sent[0]).toMatchObject({session: {qwen: {
        ref_audio: "UklGRnh4eHhXQVZF",
        ref_text: "hello",
        x_vector_only: true,
        output_policy: {
          vad_policy: {strategy: "energy", begin_threshold: 0.7, end_count: 20},
          chunk_ms: 40,
          emit_text_events: true,
          config: {delivery: "guarded", delivery_window_ms: 180},
        },
        timing: {request_id: "browser-request-1", turn_id: "turn-1", client_request_ts_ms: 123},
      }}});
      run.cancel();
    } finally {
      capabilities.reference = referenceCapabilities;
      client.close();
    }
  });

  it("fails closed when a global PCM float format is not available on Realtime", async () => {
    const originalFormats = capabilities.audio_formats;
    capabilities.audio_formats = [{encoding: "pcm_f32", sample_rate: 24000, channels: 1}];
    const {client} = setup();
    try {
      await client.connect();
      await expect(client.synthesize("hello", {
        ...options,
        audio: {encoding: AudioEncoding.PcmF32, sample_rate: 24000, channels: 1},
      })).rejects.toThrow("not supported by the Realtime endpoint");
    } finally {
      capabilities.audio_formats = originalFormats;
      client.close();
    }
  });

  it("resumes the same response and replays only unacknowledged text", async () => {
    const sockets: FakeWebSocket[] = [];
    const events: string[] = [];
    const client = new RealtimeTTSClient({
      capabilitiesUrl: "https://host/infer/id/v1/capabilities",
      fetcher: async () => new Response(JSON.stringify(capabilities)),
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
      resumeAttempts: 1,
    });
    client.onEvent((event) => events.push(event.type));
    await client.connect();
    const run = await client.startIncremental(options);
    await Promise.resolve();
    run.append("unacked");
    sockets[0]?.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(sockets).toHaveLength(2);
    expect(sockets[1]?.sent.map((event) => event.type)).toEqual([
      "session.update",
      "qwen.response.resume",
      "qwen.input_text_buffer.append",
    ]);
    expect(events).toContain("reconnecting");
    expect(events.filter((type) => type === "response_started")).toHaveLength(1);
    client.close();
  });
});
