import {describe, expect, it} from "vitest";

import {parseCapabilities, REQUIRED_REALTIME_EXTENSIONS} from "./capabilities.js";
import {resolveRelativeUrl, toWebSocketUrl} from "./urls.js";

function capabilities() {
  return {
    schema_version: "qwen.tts.capabilities.v1",
    tasks: ["custom_voice"],
    task_status: [{task: "custom_voice", available: true, stability: "stable"}],
    audio_formats: [],
    output_policy: {features: ["guarded_delivery"], vad_strategies: ["disabled"]},
    limits: {max_input_tokens: 128, max_realtime_message_bytes: 8_388_608},
    reference: {available: false, max_duration_sec: 0, max_bytes: 4_194_304, mime_types: ["audio/wav"], reason: "not loaded"},
    protocols: {
      openai_realtime: {
        path: "/v1/realtime",
        base: "openai-realtime-v1",
        extension_protocol: "qwen-realtime-v1",
        supported_extensions: [...REQUIRED_REALTIME_EXTENSIONS],
        features: [],
        audio_formats: ["pcm_s16le"],
      },
    },
  };
}

describe("capabilities", () => {
  it("accepts the versioned Realtime contract", () => {
    expect(parseCapabilities(capabilities()).tasks).toEqual(["custom_voice"]);
  });

  it("preserves cursor and speech-state capability diagnostics", () => {
    const value = capabilities();
    value.native_cursor = {
      graph_enabled: true,
      progress_available: false,
      supported_progress_modes: ["ema", "disabled"],
      reason: "cursor graph is loaded but bridge is unavailable",
    };
    value.speech_state = {supported: false, reason: "runtime_gate_disabled"};
    const parsed = parseCapabilities(value);
    expect(parsed.native_cursor?.reason).toContain("bridge");
    expect(parsed.speech_state).toEqual({supported: false, reason: "runtime_gate_disabled"});
  });

  it("fails closed when a required extension is absent", () => {
    const value = capabilities();
    value.protocols.openai_realtime.supported_extensions.pop();
    expect(() => parseCapabilities(value)).toThrow("Missing required Realtime extensions");
  });

  it("keeps reverse-proxy prefixes when resolving instance URLs", () => {
    const url = resolveRelativeUrl("../v1/realtime", "https://host/infer/id/demo/config.json");
    expect(toWebSocketUrl(url).toString()).toBe("wss://host/infer/id/v1/realtime");
  });
});
