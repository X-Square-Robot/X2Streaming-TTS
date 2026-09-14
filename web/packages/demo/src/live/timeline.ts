import {
  progressSampleBigInt,
  sortProgressEvents,
  type ProgressEvent,
} from "../upstream/progress";

// Display interpolation never determines the interrupted dialogue-history boundary.
export function playedBoundary(
  events: ProgressEvent[],
  played: bigint,
  length: number,
): number {
  let boundary = 0;
  for (const event of sortProgressEvents(events)) {
    if (progressSampleBigInt(event) > played) break;
    const raw = Number(event.meta?.raw_codepoint_end);
    if (Number.isFinite(raw)) boundary = Math.max(boundary, Math.floor(raw));
  }
  return Math.max(0, Math.min(length, boundary));
}

export function splitText(text: string, size = 2): string[] {
  if (!Number.isInteger(size) || size < 1)
    throw new Error("Chunk size must be a positive integer.");
  const chars = Array.from(text);
  const result: string[] = [];
  for (let i = 0; i < chars.length; i += size)
    result.push(chars.slice(i, i + size).join(""));
  return result;
}
