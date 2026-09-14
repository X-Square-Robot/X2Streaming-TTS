export interface AudioEnvelope {
  readonly start: number;
  readonly end: number;
  readonly peak: number;
}

const MAX_ENVELOPES = 256;

function envelopePeak(pcm: Int16Array): number {
  let peak = 0;
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  return peak / 32768;
}

function compact(history: readonly AudioEnvelope[]): AudioEnvelope[] {
  if (history.length <= MAX_ENVELOPES) return [...history];
  const result: AudioEnvelope[] = [];
  const groupCount = MAX_ENVELOPES;
  const baseSize = Math.floor(history.length / groupCount);
  const remainder = history.length % groupCount;
  let offset = 0;
  for (let index = 0; index < groupCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    const group = history.slice(offset, offset + size);
    result.push({
      start: group[0]!.start,
      end: group[group.length - 1]!.end,
      peak: Math.max(...group.map((item) => item.peak)),
    });
    offset += size;
  }
  return result;
}

/** Append one decoded PCM span while keeping a bounded, full-duration envelope. */
export function appendAudioEnvelope(
  history: readonly AudioEnvelope[],
  pcm: Int16Array,
  startSample: bigint,
  endSample: bigint,
): AudioEnvelope[] {
  if (endSample <= startSample || pcm.length === 0) return [...history];
  const next: AudioEnvelope = {
    start: Number(startSample),
    end: Number(endSample),
    peak: envelopePeak(pcm),
  };
  return compact([...history, next]);
}
