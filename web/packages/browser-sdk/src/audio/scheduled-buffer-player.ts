export interface ScheduledBufferPlayerOptions {
  onConsumed: (frames: number) => void;
  onUnderrun: () => void;
}

/**
 * Standards-based fallback for browsers that do not expose AudioWorklet.
 *
 * AudioBufferSourceNode scheduling works in non-secure HTTP contexts, while
 * keeping chunks on one continuous AudioContext timeline. BrowserAudioPlayer
 * remains responsible for resampling, queue bounds, and source cursors.
 */
export class ScheduledBufferPlayer {
  private readonly sources = new Set<AudioBufferSourceNode>();
  private scheduledThrough = 0;
  private generation = 0;

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    private readonly options: ScheduledBufferPlayerOptions,
  ) {}

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(
      1,
      samples.length,
      this.context.sampleRate,
    );
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);

    const generation = this.generation;
    const startAt = Math.max(this.context.currentTime, this.scheduledThrough);
    this.scheduledThrough = startAt + samples.length / this.context.sampleRate;
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      if (generation !== this.generation) return;
      this.sources.delete(source);
      this.options.onConsumed(samples.length);
      if (this.sources.size === 0) {
        this.scheduledThrough = this.context.currentTime;
        this.options.onUnderrun();
      }
    };
    source.start(startAt);
  }

  clear(): void {
    this.generation += 1;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source may already have ended between iteration and stop().
      }
      source.disconnect();
    }
    this.sources.clear();
    this.scheduledThrough = this.context.currentTime;
  }
}
