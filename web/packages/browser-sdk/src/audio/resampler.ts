/** Stateful linear resampler that preserves phase across arbitrary chunk boundaries. */
export class ContinuousResampler {
  readonly sourceRate: number;
  readonly destinationRate: number;
  private pending = new Float32Array(0);
  /** Source position relative to pending[0], in destination-rate ticks. */
  private positionNumerator = 0;
  private consumedFrames = 0;

  constructor(sourceRate: number, destinationRate: number) {
    if (!Number.isInteger(sourceRate) || sourceRate <= 0) {
      throw new RangeError("sourceRate must be a positive integer");
    }
    if (!Number.isInteger(destinationRate) || destinationRate <= 0) {
      throw new RangeError("destinationRate must be a positive integer");
    }
    this.sourceRate = sourceRate;
    this.destinationRate = destinationRate;
  }

  process(chunk: Float32Array): Float32Array {
    if (chunk.length === 0) return new Float32Array(0);
    const input = new Float32Array(this.pending.length + chunk.length);
    input.set(this.pending);
    input.set(chunk, this.pending.length);
    const output: number[] = [];
    while (this.positionNumerator < (input.length - 1) * this.destinationRate) {
      const left = Math.floor(this.positionNumerator / this.destinationRate);
      const fraction = (this.positionNumerator % this.destinationRate) / this.destinationRate;
      const first = input[left] ?? 0;
      const second = input[left + 1] ?? first;
      output.push(first + (second - first) * fraction);
      this.positionNumerator += this.sourceRate;
    }
    const consumed = Math.min(
      Math.floor(this.positionNumerator / this.destinationRate),
      input.length - 1,
    );
    this.pending = input.slice(consumed);
    this.positionNumerator -= consumed * this.destinationRate;
    this.consumedFrames += consumed;
    return Float32Array.from(output);
  }

  flush(): Float32Array {
    if (this.pending.length === 0) return new Float32Array(0);
    const finalSample = this.pending[this.pending.length - 1] ?? 0;
    this.consumedFrames += this.pending.length;
    this.pending = new Float32Array(0);
    this.positionNumerator = 0;
    return Float32Array.of(finalSample);
  }

  reset(): void {
    this.pending = new Float32Array(0);
    this.positionNumerator = 0;
    this.consumedFrames = 0;
  }

  consumedSourceFrames(): number {
    return this.consumedFrames;
  }
}

export function pcm16ToFloat32(samples: Int16Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, (samples[index] ?? 0) / 32768));
  }
  return output;
}
