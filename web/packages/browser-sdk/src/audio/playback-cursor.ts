interface CursorSegment {
  outputFrames: number;
  consumedFrames: number;
  sourceStart: bigint;
  sourceEnd: bigint;
}

/** Maps AudioContext frames actually consumed by the worklet back to source samples. */
export class PlaybackCursorQueue {
  private readonly segments: CursorSegment[] = [];
  private played = 0n;
  private buffered = 0n;
  private outputFrames = 0;

  push(outputFrames: number, sourceStart: bigint, sourceEnd: bigint): void {
    if (!Number.isSafeInteger(outputFrames) || outputFrames <= 0) return;
    if (sourceStart !== this.buffered || sourceEnd < sourceStart) {
      throw new RangeError("Playback source cursor must be contiguous and increasing");
    }
    this.segments.push({outputFrames, consumedFrames: 0, sourceStart, sourceEnd});
    this.outputFrames += outputFrames;
    this.buffered = sourceEnd;
  }

  consume(frames: number): {playedThroughSample: bigint; bufferedThroughSample: bigint} {
    let remaining = Math.max(0, Math.floor(frames));
    this.outputFrames = Math.max(0, this.outputFrames - remaining);
    while (remaining > 0 && this.segments.length > 0) {
      const segment = this.segments[0];
      if (!segment) break;
      const available = segment.outputFrames - segment.consumedFrames;
      const consumed = Math.min(available, remaining);
      segment.consumedFrames += consumed;
      remaining -= consumed;
      const sourceLength = segment.sourceEnd - segment.sourceStart;
      this.played = segment.sourceStart
        + sourceLength * BigInt(segment.consumedFrames) / BigInt(segment.outputFrames);
      if (segment.consumedFrames === segment.outputFrames) {
        this.played = segment.sourceEnd;
        this.segments.shift();
      }
    }
    return this.snapshot();
  }

  snapshot(): {playedThroughSample: bigint; bufferedThroughSample: bigint} {
    return {playedThroughSample: this.played, bufferedThroughSample: this.buffered};
  }

  queuedOutputFrames(): number {
    return this.outputFrames;
  }

  clear(cursor = 0n): void {
    this.segments.length = 0;
    this.played = cursor;
    this.buffered = cursor;
    this.outputFrames = 0;
  }
}
