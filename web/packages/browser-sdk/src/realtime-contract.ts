import {z} from "zod";

const baseEvent = z.object({type: z.string().min(1)}).passthrough();
const cursor = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const optionalServerTiming = z.union([z.number().finite(), z.string()]).optional();
const response = z.object({id: z.string().min(1)}).passthrough();

const businessEvents: Record<string, z.ZodTypeAny> = {
  "session.created": z.object({type: z.literal("session.created"), session: z.object({}).passthrough()}).passthrough(),
  "session.updated": z.object({type: z.literal("session.updated"), session: z.object({}).passthrough()}).passthrough(),
  "response.created": z.object({type: z.literal("response.created"), response}).passthrough(),
  "response.output_audio.delta": z.object({
    type: z.literal("response.output_audio.delta"),
    delta: z.string(),
    qwen_output_sample_start: cursor,
    qwen_output_sample_end: cursor,
    qwen_server_ttft_ms: optionalServerTiming,
  }).passthrough(),
  "response.done": z.object({
    type: z.literal("response.done"),
    response: response.extend({status: z.enum(["completed", "cancelled", "failed"])}),
  }).passthrough(),
  "qwen.input_text_buffer.ack": z.object({
    type: z.literal("qwen.input_text_buffer.ack"),
    sequence: z.number().int().nonnegative(),
  }).passthrough(),
  "qwen.text_progress": z.object({
    type: z.literal("qwen.text_progress"),
    text: z.string(),
    meta: z.object({}).passthrough(),
  }).passthrough(),
  error: z.object({
    type: z.literal("error"),
    error: z.object({message: z.string()}).passthrough(),
  }).passthrough(),
};

/** Validate versioned Qwen business fields while tolerating future OpenAI events. */
export function parseRealtimeServerEvent(value: unknown): Record<string, unknown> {
  const base = baseEvent.safeParse(value);
  if (!base.success) throw new TypeError("Realtime server event must be an object with a type");
  const schema = businessEvents[base.data.type];
  if (!schema) return base.data;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`Invalid ${base.data.type} event: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }
  return parsed.data;
}
