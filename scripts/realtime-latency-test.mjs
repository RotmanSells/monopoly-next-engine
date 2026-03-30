import { setTimeout as wait } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const serverUrl = process.env.YJS_SERVER_URL ?? "ws://127.0.0.1:1234";
const sampleSize = Number.parseInt(process.env.YJS_LATENCY_SAMPLES ?? "30", 10);
const timeoutMs = Number.parseInt(process.env.YJS_LATENCY_TIMEOUT_MS ?? "8000", 10);
const roomName = process.env.YJS_LATENCY_ROOM ?? `latency-${Date.now()}`;

function connectDoc() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(serverUrl, roomName, doc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });

  return { doc, provider };
}

async function waitFor(condition, timeout, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (condition()) {
      return;
    }
    await wait(10);
  }

  throw new Error(`Timeout while waiting for: ${label}`);
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.floor((p / 100) * values.length));
  return values[index];
}

async function run() {
  const left = connectDoc();
  const right = connectDoc();

  try {
    await waitFor(
      () => left.provider.wsconnected && right.provider.wsconnected,
      timeoutMs,
      "both providers connected",
    );

    const leftEvents = left.doc.getArray("events");
    const rightEvents = right.doc.getArray("events");
    const measured = [];

    for (let index = 0; index < sampleSize; index += 1) {
      const eventId = `lat-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = performance.now();

      leftEvents.push([
        {
          id: eventId,
          kind: "join",
          timestamp: Date.now(),
          playerId: `probe-${index}`,
          playerName: `Probe ${index}`,
          initialBalance: 1500,
        },
      ]);

      await waitFor(
        () =>
          rightEvents.toArray().some((event) => {
            if (typeof event !== "object" || event === null) {
              return false;
            }

            return "id" in event && event.id === eventId;
          }),
        timeoutMs,
        `replication for ${eventId}`,
      );

      measured.push(performance.now() - startedAt);
    }

    measured.sort((leftValue, rightValue) => leftValue - rightValue);
    const total = measured.reduce((sum, value) => sum + value, 0);

    console.log(
      JSON.stringify(
        {
          ok: true,
          serverUrl,
          roomName,
          samples: sampleSize,
          minMs: Number(measured[0].toFixed(2)),
          avgMs: Number((total / measured.length).toFixed(2)),
          p50Ms: Number(percentile(measured, 50).toFixed(2)),
          p95Ms: Number(percentile(measured, 95).toFixed(2)),
          maxMs: Number(measured[measured.length - 1].toFixed(2)),
        },
        null,
        2,
      ),
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
