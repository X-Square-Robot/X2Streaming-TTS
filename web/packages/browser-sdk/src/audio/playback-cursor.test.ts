import {describe, expect, it} from "vitest";

import {PlaybackCursorQueue} from "./playback-cursor.js";

describe("PlaybackCursorQueue", () => {
  it("reports only source samples actually consumed", () => {
    const queue = new PlaybackCursorQueue();
    queue.push(200, 0n, 100n);
    queue.push(200, 100n, 200n);
    expect(queue.snapshot()).toEqual({playedThroughSample: 0n, bufferedThroughSample: 200n});
    expect(queue.consume(50)).toEqual({playedThroughSample: 25n, bufferedThroughSample: 200n});
    expect(queue.consume(150)).toEqual({playedThroughSample: 100n, bufferedThroughSample: 200n});
    expect(queue.consume(200)).toEqual({playedThroughSample: 200n, bufferedThroughSample: 200n});
  });

  it("rejects overlapping source ranges", () => {
    const queue = new PlaybackCursorQueue();
    queue.push(10, 0n, 10n);
    expect(() => queue.push(10, 9n, 20n)).toThrow("contiguous");
    expect(() => queue.push(10, 11n, 20n)).toThrow("contiguous");
  });
});
