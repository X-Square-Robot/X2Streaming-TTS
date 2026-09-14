import {AudioEncoding, SynthesisTask, VadStrategy, type Capabilities} from "./types.js";
import {z} from "zod";

export const CAPABILITIES_SCHEMA_VERSION = "qwen.tts.capabilities.v1" as const;
export const REQUIRED_REALTIME_EXTENSIONS = [
  "qwen.input_text_buffer.v1",
  "qwen.text_progress.v1",
  "qwen.playback_ack.v1",
  "qwen.response_resume.v1",
] as const;

export class CapabilityError extends Error {
  readonly code = "unsupported_capabilities";
}

const realtimeSchema = z.object({
  path: z.string(),
  base: z.literal("openai-realtime-v1"),
  extension_protocol: z.literal("qwen-realtime-v1"),
  supported_extensions: z.array(z.string()),
  features: z.array(z.string()),
  audio_formats: z.array(z.literal(AudioEncoding.PcmS16Le)),
}).passthrough();

const capabilitiesSchema = z.object({
  schema_version: z.literal(CAPABILITIES_SCHEMA_VERSION),
  engine_version: z.string().optional(),
  model: z.string().optional(),
  tasks: z.array(z.nativeEnum(SynthesisTask)),
  task_status: z.array(z.object({
    task: z.nativeEnum(SynthesisTask),
    available: z.boolean(),
    stability: z.enum(["stable", "experimental"]),
  }).passthrough()),
  speakers: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  input_modes: z.array(z.string()).optional(),
  audio_formats: z.array(z.object({
    encoding: z.nativeEnum(AudioEncoding),
    sample_rate: z.number().int().positive(),
    channels: z.literal(1),
  }).passthrough()),
  output_policy: z.object({
    features: z.array(z.string()),
    vad_strategies: z.array(z.nativeEnum(VadStrategy)),
  }).passthrough(),
  limits: z.object({
    max_input_tokens: z.number().int().nonnegative(),
    max_realtime_message_bytes: z.number().int().positive(),
  }).passthrough(),
  reference: z.object({
    available: z.boolean(),
    max_duration_sec: z.number().nonnegative(),
    max_bytes: z.number().int().positive(),
    mime_types: z.array(z.enum(["audio/wav", "audio/x-wav"])).min(1),
    reason: z.string(),
    speaker_encoder_available: z.boolean().optional(),
    ref_codec_available: z.boolean().optional(),
    icl_available: z.boolean().optional(),
  }).passthrough(),
  protocols: z.object({openai_realtime: realtimeSchema}).passthrough(),
  native_cursor: z.object({
    graph_enabled: z.boolean(),
    progress_available: z.boolean(),
    supported_progress_modes: z.array(z.string()),
    reason: z.string().optional(),
  }).passthrough().optional(),
  speech_state: z.object({
    supported: z.boolean(),
    reason: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export function parseCapabilities(value: unknown): Capabilities {
  const result = capabilitiesSchema.safeParse(value);
  if (!result.success) {
    throw new CapabilityError(`Invalid capabilities contract: ${result.error.issues[0]?.message ?? "unknown error"}`);
  }
  const extensions = result.data.protocols.openai_realtime.supported_extensions;
  const missing = REQUIRED_REALTIME_EXTENSIONS.filter(
    (extension) => !extensions.includes(extension),
  );
  if (missing.length > 0) {
    throw new CapabilityError(`Missing required Realtime extensions: ${missing.join(", ")}`);
  }
  const availableTasks = result.data.task_status
    .filter((status) => status.available)
    .map((status) => status.task);
  if (new Set(availableTasks).size !== availableTasks.length
    || result.data.tasks.some((task) => !availableTasks.includes(task))
    || availableTasks.some((task) => !result.data.tasks.includes(task))) {
    throw new CapabilityError("tasks and available task_status entries must match exactly");
  }
  return result.data as Capabilities;
}

export async function discoverCapabilities(
  endpoint: URL | string,
  fetcher: typeof fetch = fetch,
): Promise<Capabilities> {
  const response = await fetcher(endpoint, {headers: {Accept: "application/json"}});
  if (!response.ok) {
    throw new CapabilityError(`Capabilities request failed with HTTP ${response.status}`);
  }
  return parseCapabilities(await response.json());
}
