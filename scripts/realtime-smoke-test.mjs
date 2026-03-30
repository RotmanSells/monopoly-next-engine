import { setTimeout as wait } from "node:timers/promises";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const serverUrl = process.env.YJS_SERVER_URL ?? "ws://127.0.0.1:1234";
const roomName = process.env.YJS_SMOKE_ROOM ?? `smoke-${Date.now()}`;
const timeoutMs = Number.parseInt(process.env.YJS_SMOKE_TIMEOUT_MS ?? "8000", 10);

function connectDoc(server, room) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(server, room, doc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });

  return { doc, provider };
}

async function waitFor(condition, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }
    await wait(50);
  }

  throw new Error(`Timeout while waiting for: ${label}`);
}

async function run() {
  const left = connectDoc(serverUrl, roomName);
  const right = connectDoc(serverUrl, roomName);

  try {
    await waitFor(
      () => left.provider.wsconnected && right.provider.wsconnected,
      "both websocket providers connected",
    );

    const leftEvents = left.doc.getArray("events");
    const rightEvents = right.doc.getArray("events");

    leftEvents.push([
      {
        id: `join-${Date.now()}`,
        kind: "join",
        timestamp: Date.now(),
        playerId: "smoke-player",
        playerName: "Smoke Test",
        initialBalance: 1500,
      },
    ]);

    await waitFor(
      () =>
        rightEvents.toArray().some((event) => {
          if (typeof event !== "object" || event === null) {
            return false;
          }

          return "playerId" in event && event.playerId === "smoke-player";
        }),
      "event replicated to second client",
    );

    console.log(
      JSON.stringify({
        ok: true,
        serverUrl,
        roomName,
      }),
    );
  } finally {
    left.provider.destroy();
    right.provider.destroy();
    left.doc.destroy();
    right.doc.destroy();
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      serverUrl,
      roomName,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
