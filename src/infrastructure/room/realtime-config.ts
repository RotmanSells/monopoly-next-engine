const DEFAULT_WEBSOCKET_SERVERS = ["wss://demos.yjs.dev", "wss://demos.yjs.dev/ws"] as const;
const WEBSOCKET_SERVER_SPLITTER = /[\n,]/u;

function sanitizeWebsocketServer(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  let normalized = trimmed;
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (!normalized.startsWith("ws://") && !normalized.startsWith("wss://")) {
    return null;
  }

  return normalized;
}

export function normalizeWebsocketServers(rawValue: string | null | undefined): string[] {
  if (!rawValue) {
    return [...DEFAULT_WEBSOCKET_SERVERS];
  }

  const unique = new Set<string>();

  for (const candidate of rawValue.split(WEBSOCKET_SERVER_SPLITTER)) {
    const server = sanitizeWebsocketServer(candidate);
    if (server) {
      unique.add(server);
    }
  }

  if (unique.size === 0) {
    return [...DEFAULT_WEBSOCKET_SERVERS];
  }

  return [...unique];
}

export function resolveWebsocketServers(): string[] {
  return normalizeWebsocketServers(process.env.NEXT_PUBLIC_YJS_WEBSOCKET_SERVER);
}

export const WEBSOCKET_DEFAULTS = {
  servers: [...DEFAULT_WEBSOCKET_SERVERS],
} as const;
