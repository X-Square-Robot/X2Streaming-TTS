export enum SynthesisTask {
  Base = "base",
  VoiceClone = "voice_clone",
  CustomVoice = "custom_voice",
  VoiceDesign = "voice_design",
}

export enum InputMode {
  FullText = "full_text",
  Token = "token",
  Clause = "clause",
  LongSegment = "long_segment",
}

export enum AudioEncoding {
  PcmF32 = "pcm_f32",
  PcmS16Le = "pcm_s16le",
}

export enum VadStrategy {
  Disabled = "disabled",
  Energy = "energy",
  TenVad = "tenvad",
}

export enum DeliveryPolicy {
  Guarded = "guarded",
  Firehose = "firehose",
}

export interface AudioFormat {
  encoding: AudioEncoding;
  sample_rate: number;
  channels: 1;
}

export interface SynthesisOptions {
  task: SynthesisTask;
  speaker?: string;
  language?: string;
  instruct?: string;
  reference?: ReferenceAudioOptions;
  inputMode?: InputMode;
  audio?: AudioFormat;
  vad?: VadOptions;
  delivery?: DeliveryPolicy;
  outputPolicy?: OutputPolicyOptions;
  timing?: TimingContextOptions;
}

export interface ReferenceAudioOptions {
  /** Base64-encoded complete audio file, without a data-URL prefix. */
  audioBase64: string;
  text?: string;
  xVectorOnly?: boolean;
}

export interface VadOptions {
  strategy: VadStrategy;
  enabled: boolean;
  chunk_ms?: number;
  begin_threshold?: number;
  begin_count?: number;
  end_threshold?: number;
  end_count?: number;
  start_margin_ms?: number;
}

export interface OutputPolicyOptions {
  delivery?: DeliveryPolicy;
  delivery_window_ms?: number;
  chunk_ms?: number;
  emit_text_events?: boolean;
}

export interface TimingContextOptions {
  request_id?: string;
  turn_id?: string;
  client_request_ts_ms?: number;
  client_text_ts_ms?: number;
  client_end_ts_ms?: number;
  extra?: Record<string, string>;
}

export interface ServerDiagnostics {
  ttft_ms?: number;
  total_ms?: number;
  engine_queue_wait_ms?: number;
  engine_prefill_ms?: number;
  first_text_dequeue_to_first_raw_audio_ms?: number;
  first_raw_to_first_effective_audio_ms?: number;
  prefix_trimmed_ms?: number;
  prefix_trim_applied?: boolean;
  vad_strategy?: string;
}

export interface RealtimeProtocolCapabilities {
  path: string;
  base: "openai-realtime-v1";
  extension_protocol: "qwen-realtime-v1";
  supported_extensions: string[];
  features: string[];
  audio_formats: string[];
}

export interface NativeCursorCapabilities {
  graph_enabled: boolean;
  progress_available: boolean;
  supported_progress_modes: string[];
  reason?: string;
  max_labels?: number;
  vocab_size?: number;
  cursor_head_sha256?: string;
  cursor_vocab_sha256?: string;
  cursor_rules_sha256?: string;
  model_fingerprint?: string;
}

export interface SpeechStateCapabilities {
  supported: boolean;
  reason?: string;
  model_fingerprint?: string;
  runtime_fingerprint?: string;
}

export interface Capabilities {
  schema_version: "qwen.tts.capabilities.v1";
  engine_version?: string;
  model?: string;
  tasks: SynthesisTask[];
  task_status: Array<{task: SynthesisTask; available: boolean; stability: "stable" | "experimental"}>;
  speakers?: string[];
  languages?: string[];
  input_modes?: string[];
  audio_formats: AudioFormat[];
  limits: {max_input_tokens: number; max_realtime_message_bytes: number};
  output_policy: {features: string[]; vad_strategies: VadStrategy[]};
  reference: {
    available: boolean;
    max_duration_sec: number;
    max_bytes: number;
    mime_types: string[];
    reason: string;
    speaker_encoder_available?: boolean;
    ref_codec_available?: boolean;
    icl_available?: boolean;
  };
  protocols: {openai_realtime: RealtimeProtocolCapabilities};
  native_cursor?: NativeCursorCapabilities;
  speech_state?: SpeechStateCapabilities;
}

export type TTSEvent =
  | {type: "connected"}
  | {type: "response_started"; responseId: string}
  | {type: "audio"; pcm: Int16Array; startSample: bigint; endSample: bigint; server?: ServerDiagnostics}
  | {type: "progress"; text: string; sample: bigint; meta?: Record<string, unknown>}
  | {type: "warning"; message: string}
  | {type: "completed"; responseId: string; usage?: Record<string, number>; server?: ServerDiagnostics}
  | {type: "cancelled"; responseId: string}
  | {type: "reconnecting"; attempt: number}
  | {type: "error"; code: string; message: string};
