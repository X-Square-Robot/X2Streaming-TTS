import {describe, expect, it} from "vitest";

import {appendAudioEnvelope} from "./audio-envelope";

describe("appendAudioEnvelope", () => {
  it("keeps the first and last coordinates when compacting", () => {
    const history = Array.from({length: 256}, (_, index) => ({start: index * 10, end: index * 10 + 10, peak: .1}));
    const result = appendAudioEnvelope(history, Int16Array.from([32767]), 2560n, 2570n);
    expect(result).toHaveLength(256);
    expect(result[0]!.start).toBe(0);
    expect(result.at(-1)?.end).toBe(2570);
    expect(result.at(-1)?.peak).toBeCloseTo(32767 / 32768);
  });

  it("preserves the maximum peak and coordinate span of merged groups", () => {
    const history = Array.from({length: 257}, (_, index) => ({start: index, end: index + 1, peak: index === 4 ? .95 : .1}));
    const result = appendAudioEnvelope(history, Int16Array.from([1000]), 257n, 258n);
    expect(result).toHaveLength(256);
    expect(Math.max(...result.map((item) => item.peak))).toBe(.95);
    expect(result[0]!.start).toBe(0);
    expect(result.at(-1)?.end).toBe(258);
  });

  it("skips zero-length spans and never loops over a huge sample range", () => {
    const history = [{start: 4, end: 8, peak: .5}];
    expect(appendAudioEnvelope(history, Int16Array.from([32767]), 10n, 10n)).toEqual(history);
    expect(appendAudioEnvelope(history, new Int16Array(), 10n, 999999999999999999n)).toEqual(history);
  });
});
