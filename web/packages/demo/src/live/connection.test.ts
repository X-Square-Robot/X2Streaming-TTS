import { describe, expect, it } from "vitest";
import { capabilitiesEndpoint, realtimeEndpoint } from "./connection";

describe("engine endpoints", () => {
  const page = "http://localhost:4173/project/";
  it.each([
    [
      "wss://engine.example/v1/realtime",
      "https://engine.example/v1/capabilities",
    ],
    ["ws://localhost:8000/v1/ws", "http://localhost:8000/v1/capabilities"],
    ["http://localhost:8000/v1/", "http://localhost:8000/v1/capabilities"],
    ["/engine", "http://localhost:4173/engine/v1/capabilities"],
    [
      "https://engine.example/infer/one/demo/",
      "https://engine.example/infer/one/v1/capabilities",
    ],
  ])("discovers capabilities from %s", (value, expected) => {
    expect(capabilitiesEndpoint(value, page).href).toBe(expected);
  });
  it.each([
    "",
    "ftp://example.org",
    "https://user:secret@example.org",
    "https://example.org?token=secret",
    "https://example.org/#key",
  ])("rejects an invalid endpoint: %s", (value) => {
    expect(() => capabilitiesEndpoint(value, page)).toThrow();
  });
  it("refuses mixed content on a published HTTPS page", () => {
    expect(() =>
      capabilitiesEndpoint(
        "ws://engine.example/v1/realtime",
        "https://demo.example/",
      ),
    ).toThrow(/HTTPS/);
  });
  it("preserves a proxy prefix exactly once", () => {
    const cap = new URL("https://engine.example/infer/one/v1/capabilities");
    for (const advertised of [
      "/v1/realtime",
      "v1/realtime",
      "/infer/one/v1/realtime",
    ]) {
      expect(realtimeEndpoint(cap, advertised).href).toBe(
        "wss://engine.example/infer/one/v1/realtime",
      );
    }
  });
  it("does not follow capabilities to another origin", () => {
    expect(() =>
      realtimeEndpoint(
        new URL("https://engine.example/v1/capabilities"),
        "https://other.example/v1/realtime",
      ),
    ).toThrow(/same engine origin/);
  });
});
