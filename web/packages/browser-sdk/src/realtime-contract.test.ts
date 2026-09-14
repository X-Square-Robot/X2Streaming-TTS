import {describe, expect, it} from "vitest";

import {parseRealtimeServerEvent} from "./realtime-contract.js";

describe("Realtime business event contract", () => {
  it("accepts a contiguous audio event with int64 cursors", () => {
    expect(parseRealtimeServerEvent({
      type: "response.output_audio.delta",
      delta: "AAA=",
      qwen_output_sample_start: "9007199254740993",
      qwen_output_sample_end: "9007199254740994",
      qwen_server_ttft_ms: "12.5",
    }).type).toBe("response.output_audio.delta");
  });

  it("rejects malformed known business events", () => {
    expect(() => parseRealtimeServerEvent({
      type: "response.output_audio.delta",
      delta: 123,
      qwen_output_sample_start: -1,
      qwen_output_sample_end: "bad",
    })).toThrow(/Invalid response\.output_audio\.delta/);
  });

  it("keeps forward-compatible unknown OpenAI events", () => {
    expect(parseRealtimeServerEvent({type: "rate_limits.updated", rate_limits: []}).type)
      .toBe("rate_limits.updated");
  });
});
