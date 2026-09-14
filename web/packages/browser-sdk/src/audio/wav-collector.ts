export interface WavCollectorOptions {
  sampleRate: number;
  maxBytes?: number;
}

export interface WavCollectorSnapshot {
  readonly sampleRate: number;
  readonly samples: number;
  readonly pcmBytes: number;
  readonly collecting: boolean;
  readonly limitReached: boolean;
}

/** Bounded PCM16 collector. Reaching the limit never interrupts live playback. */
export class WavCollector {
  readonly sampleRate: number;
  readonly maxBytes: number;
  private chunks: Int16Array[] = [];
  private sampleCount = 0;
  private collecting = true;
  private limitReached = false;

  constructor(options: WavCollectorOptions) {
    if (!Number.isInteger(options.sampleRate) || options.sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive integer");
    }
    this.sampleRate = options.sampleRate;
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 44) {
      throw new RangeError("maxBytes must allow at least a WAV header");
    }
  }

  append(samples: Int16Array): boolean {
    if (!this.collecting || samples.length === 0) return this.collecting;
    const remainingSamples = Math.floor((this.maxBytes - 44) / 2) - this.sampleCount;
    if (remainingSamples <= 0) {
      this.collecting = false;
      this.limitReached = true;
      return false;
    }
    const accepted = samples.length <= remainingSamples
      ? samples
      : samples.subarray(0, remainingSamples);
    this.chunks.push(accepted.slice());
    this.sampleCount += accepted.length;
    if (accepted.length !== samples.length) {
      this.collecting = false;
      this.limitReached = true;
    }
    return this.collecting;
  }

  stop(): void {
    this.collecting = false;
  }

  reset(): void {
    this.chunks = [];
    this.sampleCount = 0;
    this.collecting = true;
    this.limitReached = false;
  }

  snapshot(): WavCollectorSnapshot {
    return {
      sampleRate: this.sampleRate,
      samples: this.sampleCount,
      pcmBytes: this.sampleCount * 2,
      collecting: this.collecting,
      limitReached: this.limitReached,
    };
  }

  toArrayBuffer(): ArrayBuffer {
    const result = new ArrayBuffer(44 + this.sampleCount * 2);
    const view = new DataView(result);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + this.sampleCount * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, this.sampleCount * 2, true);
    let offset = 44;
    for (const chunk of this.chunks) {
      for (const sample of chunk) {
        view.setInt16(offset, sample, true);
        offset += 2;
      }
    }
    return result;
  }

  toBlob(): Blob {
    return new Blob([this.toArrayBuffer()], {type: "audio/wav"});
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
