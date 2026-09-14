import type {TTSEvent} from "@xmultimodalinteraction/qwen3tts-browser";

export type ProgressEvent = Extract<TTSEvent, {type: "progress"}>;

/** Read the timeline coordinate without converting a bigint sample to float. */
export function progressSampleBigInt(event: ProgressEvent): bigint {
  if (event.sample > 0n) return event.sample;
  const value = event.meta?.output_sample_end;
  try {
    if (typeof value === "bigint") return value >= 0n ? value : 0n;
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
    if (typeof value === "string" && value.trim()) {
      const parsed = BigInt(value);
      return parsed >= 0n ? parsed : 0n;
    }
  } catch {
    // Fall through to the conservative zero coordinate for malformed legacy
    // metadata; rendering must remain available even when diagnostics are not.
  }
  return 0n;
}

/**
 * Return the final PCM coordinate carried by a progress event.
 *
 * Realtime events normally provide this as a bigint `sample`; the metadata
 * fallback keeps legacy transports and captured traces renderable.
 */
export function progressSample(event: ProgressEvent): number {
  const sample = Number(progressSampleBigInt(event));
  return Number.isFinite(sample) && sample >= 0 ? sample : 0;
}

/** Return the conservative raw text boundary represented by an event. */
export function progressRawEnd(event: ProgressEvent, length: number): number {
  const meta = event.meta ?? {};
  const display = Number(meta.display_raw_position);
  const committed = Number(meta.raw_codepoint_end);
  // EMA's frame ratio is intentionally not converted into a raw character
  // offset. Only the server's owner-span coordinate (or its display-only
  // interpolation) may move the text highlight.
  const value = Number.isFinite(display) && Number.isFinite(committed)
    ? Math.max(display, committed)
    : Number.isFinite(display)
      ? display
      : Number.isFinite(committed)
        ? committed
        : 0;
  return Math.max(0, Math.min(length, Number.isFinite(value) ? value : 0));
}

function progressAnchorSeq(event: ProgressEvent): number {
  const value = Number(event.meta?.anchor_seq);
  return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

function progressSegment(event: ProgressEvent): number {
  const value = Number(event.meta?.segment_id ?? event.meta?.segment_idx);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * Canonicalize progress history by the output timeline, never by arrival.
 *
 * A resumed/replayed response or a multiplexed segment can deliver an older
 * progress marker after a newer one. Sorting on the server-assigned sample
 * coordinate (then anchor sequence and stable tie breakers) prevents the UI
 * cursor and chart from moving backwards when that happens.
 */
export function sortProgressEvents(events: ProgressEvent[]): ProgressEvent[] {
  return events
    .map((event, index) => ({
      event,
      index,
      sample: progressSampleBigInt(event),
      anchorSeq: progressAnchorSeq(event),
      rawEnd: progressRawEnd(event, Number.POSITIVE_INFINITY),
      segment: progressSegment(event),
    }))
    .sort((left, right) => (
      (left.sample < right.sample ? -1 : left.sample > right.sample ? 1 : 0)
      || left.anchorSeq - right.anchorSeq
      || left.rawEnd - right.rawEnd
      || left.segment - right.segment
      || left.index - right.index
    ))
    .map(({event}) => event);
}

/** Return the greatest raw boundary observed through `index` in canonical order. */
export function monotonicRawEnd(events: ProgressEvent[], index: number, length: number): number {
  return events.slice(0, index + 1).reduce(
    (highWater, event) => Math.max(highWater, progressRawEnd(event, length)),
    0,
  );
}

/** Return the latest progress marker on the output timeline. */
export function latestProgressEvent(events: ProgressEvent[]): ProgressEvent | undefined {
  return sortProgressEvents(events).at(-1);
}

/** Keep a live played/buffered fraction from receding while its PCM horizon grows. */
export function monotonicSampleRatio(previous: number, numerator: bigint, denominator: bigint): number {
  const prior = Number.isFinite(previous) ? Math.max(0, Math.min(1, previous)) : 0;
  if (denominator <= 0n) return prior;
  const bounded = numerator <= 0n ? 0n : numerator >= denominator ? 10_000n : numerator * 10_000n / denominator;
  return Math.max(prior, Number(bounded) / 10_000);
}
