import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "../upstream/progress";
import { playedBoundary, splitText } from "./timeline";

function anchor(sample: bigint, raw: number, display = raw): ProgressEvent {
  return {
    type: "progress",
    text: "",
    sample,
    meta: { raw_codepoint_end: raw, display_raw_position: display },
  };
}
describe("interrupted dialogue history", () => {
  it("retains only conservative anchors already reached by playback", () => {
    const events = [
      anchor(300n, 10),
      anchor(100n, 2, 5.8),
      anchor(200n, 4, 8.2),
    ];
    expect(playedBoundary(events, 99n, 20)).toBe(0);
    expect(playedBoundary(events, 100n, 20)).toBe(2);
    expect(playedBoundary(events, 250n, 20)).toBe(4);
  });
  it("does not retreat on a late anchor or exceed the original text", () => {
    expect(playedBoundary([anchor(1n, 8), anchor(2n, 3)], 2n, 20)).toBe(8);
    expect(playedBoundary([anchor(1n, 100)], 1n, 9)).toBe(9);
  });
  it("does not invent a raw boundary from interpolation alone", () => {
    expect(
      playedBoundary(
        [
          {
            type: "progress",
            text: "",
            sample: 1n,
            meta: { display_raw_position: 5.8 },
          },
        ],
        1n,
        10,
      ),
    ).toBe(0);
  });
  it("keeps large sample coordinates exact", () => {
    const sample = 9007199254740995n;
    expect(playedBoundary([anchor(sample, 3)], sample - 1n, 10)).toBe(0);
  });
});
describe("incremental text input", () => {
  it("does not split surrogate pairs", () => {
    expect(splitText("河狸🌙hello", 2)).toEqual(["河狸", "🌙h", "el", "lo"]);
  });
  it("rejects a nonpositive or fractional chunk size", () => {
    for (const size of [0, -1, 0.5])
      expect(() => splitText("text", size)).toThrow();
  });
});
