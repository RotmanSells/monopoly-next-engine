import { normalizeWebsocketServers, WEBSOCKET_DEFAULTS } from "@/src/infrastructure/room/realtime-config";
import { describe, expect, it } from "vitest";

describe("realtime-config", () => {
  it("returns defaults when value is empty", () => {
    expect(normalizeWebsocketServers(undefined)).toEqual(WEBSOCKET_DEFAULTS.servers);
    expect(normalizeWebsocketServers("")).toEqual(WEBSOCKET_DEFAULTS.servers);
    expect(normalizeWebsocketServers("   ")).toEqual(WEBSOCKET_DEFAULTS.servers);
  });

  it("parses, sanitizes and deduplicates configured websocket servers", () => {
    const resolved = normalizeWebsocketServers(
      " wss://primary.example/ , ws://backup.example,\nwss://primary.example ",
    );

    expect(resolved).toEqual(["wss://primary.example", "ws://backup.example"]);
  });

  it("falls back to defaults when all configured values are invalid", () => {
    expect(normalizeWebsocketServers("https://nope.example, ftp://nope.example")).toEqual(
      WEBSOCKET_DEFAULTS.servers,
    );
  });
});
