import {
  discoverCapabilities,
  type Capabilities,
} from "@xmultimodalinteraction/qwen3tts-browser";

export interface Connection {
  capabilitiesUrl: string;
  websocketUrl: string;
  capabilities: Capabilities;
}

export function capabilitiesEndpoint(value: string, pageUrl: string): URL {
  if (!value.trim()) throw new Error("Enter the engine endpoint.");
  const url = new URL(value.trim(), pageUrl);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol))
    throw new Error("Use an HTTP(S) or WebSocket URL.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Use an endpoint URL without credentials, query parameters or fragments.",
    );
  url.protocol =
    url.protocol === "wss:"
      ? "https:"
      : url.protocol === "ws:"
        ? "http:"
        : url.protocol;
  if (new URL(pageUrl).protocol === "https:" && url.protocol !== "https:")
    throw new Error("An HTTPS demo needs an HTTPS / WSS engine endpoint.");
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = /\/v1\/(?:realtime|ws|capabilities)$/.test(path)
    ? path.replace(/\/v1\/[^/]+$/, "/v1/capabilities")
    : /\/v1$/.test(path)
      ? `${path}/capabilities`
      : `${path.replace(/\/demo$/, "")}/v1/capabilities`;
  return url;
}

export function realtimeEndpoint(
  capabilitiesUrl: URL,
  advertisedPath: string,
): URL {
  const prefix = capabilitiesUrl.pathname.replace(/\/v1\/capabilities$/, "/");
  const base = new URL(prefix, capabilitiesUrl);
  const path =
    prefix !== "/" && advertisedPath.startsWith(prefix)
      ? advertisedPath.slice(prefix.length)
      : advertisedPath.replace(/^\//, "");
  const result = new URL(path, base);
  if (
    result.origin !== capabilitiesUrl.origin ||
    !["http:", "https:"].includes(result.protocol)
  ) {
    throw new Error(
      "The advertised WebSocket must use the same engine origin.",
    );
  }
  result.protocol = result.protocol === "https:" ? "wss:" : "ws:";
  return result;
}

export async function connectEngine(
  value: string,
  pageUrl = window.location.href,
): Promise<Connection> {
  const endpoint = capabilitiesEndpoint(value, pageUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const capabilities = await discoverCapabilities(endpoint, (input, init) =>
      fetch(input, { ...init, signal: controller.signal }),
    );
    return {
      capabilitiesUrl: endpoint.href,
      websocketUrl: realtimeEndpoint(
        endpoint,
        capabilities.protocols.openai_realtime.path,
      ).href,
      capabilities,
    };
  } finally {
    clearTimeout(timer);
  }
}
