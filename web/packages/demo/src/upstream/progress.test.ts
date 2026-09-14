import {describe, expect, it} from "vitest";

import {
  latestProgressEvent,
  monotonicSampleRatio,
  monotonicRawEnd,
  progressRawEnd,
  progressSampleBigInt,
  sortProgressEvents,
  type ProgressEvent,
} from "./progress";

function progress(sample: bigint, rawEnd: number, anchorSeq: number, segmentId: number): ProgressEvent {
  return {
    type: "progress",
    text: "",
    sample,
    meta: {
      output_sample_end: sample.toString(),
      raw_codepoint_end: String(rawEnd),
      anchor_seq: String(anchorSeq),
      segment_id: String(segmentId),
    },
  };
}

describe("progress timeline", () => {
  it("orders late cross-segment events by output sample, not arrival", () => {
    const lateSegment = progress(240n, 8, 2, 1);
    const firstSegment = progress(120n, 4, 1, 0);

    const ordered = sortProgressEvents([lateSegment, firstSegment]);

    expect(ordered).toEqual([firstSegment, lateSegment]);
    expect(monotonicRawEnd(ordered, 1, 20)).toBe(8);
    expect(latestProgressEvent([lateSegment, firstSegment])).toBe(lateSegment);
  });

  it("keeps equal-sample anchors deterministic with anchor sequence", () => {
    const second = progress(120n, 8, 2, 1);
    const first = progress(120n, 4, 1, 0);
    expect(sortProgressEvents([second, first])).toEqual([first, second]);
  });

  it("preserves bigint sample ordering beyond Number's safe integer range", () => {
    const first = progress(9_007_199_254_740_993n, 4, 1, 0);
    const second = progress(9_007_199_254_740_994n, 8, 2, 1);
    expect(sortProgressEvents([second, first])).toEqual([first, second]);
    expect(progressSampleBigInt(first)).toBe(9_007_199_254_740_993n);
  });

  it("keeps a coordinate high-water when a late marker has a lower display span", () => {
    const newest = progress(180n, 9, 2, 1);
    const late = progress(240n, 5, 3, 1);
    const ordered = sortProgressEvents([newest, late]);
    expect(monotonicRawEnd(ordered, 1, 20)).toBe(9);
    expect(monotonicRawEnd(ordered, 0, 20)).toBe(9);
  });

  it("keeps live audio track high-water when the generated horizon grows", () => {
    const first = monotonicSampleRatio(0, 100n, 200n);
    const later = monotonicSampleRatio(first, 120n, 400n);
    expect(first).toBe(0.5);
    expect(later).toBe(first);
    expect(monotonicSampleRatio(later, 250n, 400n)).toBe(0.625);
  });

  it("never hides a confirmed boundary behind a smaller display interpolation", () => {
    const event = progress(100n, 20, 1, 0);
    event.meta = {...event.meta, display_raw_position: "6.0"};
    expect(progressRawEnd(event, 30)).toBe(20);
  });
});
