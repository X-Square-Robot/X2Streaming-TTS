export function resolveRelativeUrl(relative: string, sourceUrl: URL | string): URL {
  return new URL(relative, sourceUrl);
}

export function toWebSocketUrl(url: URL | string): URL {
  const resolved = new URL(url);
  if (resolved.protocol === "https:") resolved.protocol = "wss:";
  else if (resolved.protocol === "http:") resolved.protocol = "ws:";
  else if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new TypeError(`Cannot convert ${resolved.protocol} URL to WebSocket`);
  }
  return resolved;
}
