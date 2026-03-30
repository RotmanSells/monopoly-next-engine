import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { RoomDomainError } from "@/src/domain/room/errors";
import {
  addPlayerToRoom,
  applyRoomOperation,
  createRoomState,
  removePlayerFromRoom,
  ROOM_BALANCE_DEFAULTS,
} from "@/src/domain/room/room-rules";
import { RoomOperationPayload, RoomOperationType, RoomState } from "@/src/domain/room/types";
import { resolveWebsocketServers } from "@/src/infrastructure/room/realtime-config";

const WEBSOCKET_SERVERS = resolveWebsocketServers();
const FAILOVER_RETRY_THRESHOLD = 1;
const FAILOVER_MIN_INTERVAL_MS = 800;
const PROVIDER_MAX_BACKOFF_MS = 700;
const PROVIDER_RESYNC_INTERVAL_MS = 4_000;

type JoinEvent = {
  id: string;
  kind: "join";
  timestamp: number;
  playerId: string;
  playerName: string;
  initialBalance: number;
};

type LeaveEvent = {
  id: string;
  kind: "leave";
  timestamp: number;
  playerId: string;
};

type OperationEvent = {
  id: string;
  kind: "operation";
  timestamp: number;
  payload: {
    type: RoomOperationType;
    playerId: string;
    amount: number;
    recipientPlayerId?: string;
  };
};

type RoomEvent = JoinEvent | LeaveEvent | OperationEvent;
type RoomListener = (room: RoomState | null) => void;

type RoomChannel = {
  roomCode: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
  providerRevision: number;
  websocketServers: string[];
  activeServerIndex: number;
  hasSyncedAtLeastOnce: boolean;
  failedConnectionEvents: number;
  nextFailoverAllowedAt: number;
  events: Y.Array<RoomEvent>;
  projectedState: RoomState | null;
  projectedEventCount: number;
  listeners: Set<RoomListener>;
};

const channels = new Map<string, RoomChannel>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ensurePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseOperationType(value: unknown): RoomOperationType | null {
  switch (value) {
    case "add":
    case "remove":
    case "transfer":
    case "toBank":
    case "fromBank":
    case "toPool":
    case "fromPool":
      return value;
    default:
      return null;
  }
}

function parseRoomEvent(rawEvent: unknown): RoomEvent | null {
  if (!isObjectRecord(rawEvent)) {
    return null;
  }

  const kind = rawEvent.kind;
  const id = typeof rawEvent.id === "string" ? rawEvent.id : "";
  const timestamp =
    typeof rawEvent.timestamp === "number" && Number.isFinite(rawEvent.timestamp)
      ? rawEvent.timestamp
      : Date.now();

  if (!id) {
    return null;
  }

  if (kind === "join") {
    const playerId = typeof rawEvent.playerId === "string" ? rawEvent.playerId : "";
    const playerName = typeof rawEvent.playerName === "string" ? rawEvent.playerName : "";

    if (!playerId || !playerName) {
      return null;
    }

    return {
      id,
      kind: "join",
      timestamp,
      playerId,
      playerName,
      initialBalance: ensurePositiveNumber(rawEvent.initialBalance, ROOM_BALANCE_DEFAULTS.player),
    };
  }

  if (kind === "leave") {
    const playerId = typeof rawEvent.playerId === "string" ? rawEvent.playerId : "";
    if (!playerId) {
      return null;
    }

    return {
      id,
      kind: "leave",
      timestamp,
      playerId,
    };
  }

  if (kind === "operation") {
    if (!isObjectRecord(rawEvent.payload)) {
      return null;
    }

    const type = parseOperationType(rawEvent.payload.type);
    const playerId = typeof rawEvent.payload.playerId === "string" ? rawEvent.payload.playerId : "";
    const amount = ensurePositiveNumber(rawEvent.payload.amount, 0);
    const recipientPlayerId =
      typeof rawEvent.payload.recipientPlayerId === "string"
        ? rawEvent.payload.recipientPlayerId
        : undefined;

    if (!type || !playerId || amount <= 0) {
      return null;
    }

    return {
      id,
      kind: "operation",
      timestamp,
      payload: {
        type,
        playerId,
        amount,
        recipientPlayerId,
      },
    };
  }

  return null;
}

function createEventId(kind: RoomEvent["kind"]): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${kind}-${randomPart}`;
}

function channelName(roomCode: string): string {
  return `monopoly-room-${roomCode}`;
}

function applyEventToRoomState(roomCode: string, state: RoomState | null, event: RoomEvent): RoomState | null {
  if (event.kind === "join") {
    const baseState = state ?? createRoomState(roomCode, event.timestamp);
    return addPlayerToRoom(baseState, {
      playerId: event.playerId,
      playerName: event.playerName,
      initialBalance: event.initialBalance,
      now: event.timestamp,
    });
  }

  if (event.kind === "leave") {
    if (!state) {
      return null;
    }
    return removePlayerFromRoom(state, event.playerId, event.timestamp);
  }

  if (!state) {
    return null;
  }

  try {
    return applyRoomOperation(state, {
      type: event.payload.type,
      playerId: event.payload.playerId,
      amount: event.payload.amount,
      recipientPlayerId: event.payload.recipientPlayerId,
      now: event.timestamp,
    });
  } catch (error) {
    if (error instanceof RoomDomainError) {
      return state;
    }
    throw error;
  }
}

// Keeps room projection incremental: only new events are applied after each sync tick.
function projectChannelState(channel: RoomChannel): RoomState | null {
  const totalEvents = channel.events.length;
  if (totalEvents === 0) {
    channel.projectedState = null;
    channel.projectedEventCount = 0;
    return null;
  }

  if (channel.projectedEventCount > totalEvents) {
    channel.projectedState = null;
    channel.projectedEventCount = 0;
  }

  if (channel.projectedEventCount === totalEvents) {
    return channel.projectedState;
  }

  const rawDelta = channel.events.slice(channel.projectedEventCount, totalEvents);
  let state = channel.projectedState;

  for (const rawEvent of rawDelta) {
    const parsedEvent = parseRoomEvent(rawEvent);
    if (!parsedEvent) {
      continue;
    }

    state = applyEventToRoomState(channel.roomCode, state, parsedEvent);
  }

  channel.projectedState = state;
  channel.projectedEventCount = totalEvents;
  return state;
}

function emitChannel(channel: RoomChannel): void {
  const state = projectChannelState(channel);
  channel.listeners.forEach((listener) => listener(state));
}

function parseProviderStatus(rawStatus: unknown): "connected" | "connecting" | "disconnected" | null {
  if (!isObjectRecord(rawStatus)) {
    return null;
  }

  const candidate = rawStatus.status;
  if (candidate === "connected" || candidate === "connecting" || candidate === "disconnected") {
    return candidate;
  }

  return null;
}

function createProvider(serverUrl: string, roomCode: string, doc: Y.Doc): WebsocketProvider {
  return new WebsocketProvider(serverUrl, channelName(roomCode), doc, {
    maxBackoffTime: PROVIDER_MAX_BACKOFF_MS,
    resyncInterval: PROVIDER_RESYNC_INTERVAL_MS,
  });
}

function maybeRotateProvider(channel: RoomChannel): void {
  if (channel.websocketServers.length <= 1) {
    return;
  }

  const now = Date.now();
  if (now < channel.nextFailoverAllowedAt) {
    return;
  }

  if (channel.failedConnectionEvents < FAILOVER_RETRY_THRESHOLD) {
    return;
  }

  channel.nextFailoverAllowedAt = now + FAILOVER_MIN_INTERVAL_MS;
  const previousProvider = channel.provider;

  channel.activeServerIndex = (channel.activeServerIndex + 1) % channel.websocketServers.length;
  channel.providerRevision += 1;
  channel.provider = createProvider(channel.websocketServers[channel.activeServerIndex], channel.roomCode, channel.doc);
  channel.hasSyncedAtLeastOnce = false;
  channel.failedConnectionEvents = 0;

  bindProviderEvents(channel, channel.providerRevision);
  previousProvider.destroy();
}

function bindProviderEvents(channel: RoomChannel, revision: number): void {
  const notifyIfCurrentProvider = () => {
    if (revision !== channel.providerRevision) {
      return;
    }
    emitChannel(channel);
  };

  channel.provider.on("sync", (isSynced: unknown) => {
    if (revision !== channel.providerRevision) {
      return;
    }

    if (isSynced === true) {
      channel.hasSyncedAtLeastOnce = true;
      channel.failedConnectionEvents = 0;
    }

    emitChannel(channel);
  });

  channel.provider.on("status", (event: unknown) => {
    if (revision !== channel.providerRevision) {
      return;
    }

    const status = parseProviderStatus(event);
    if (status === "connected") {
      channel.failedConnectionEvents = 0;
      emitChannel(channel);
      return;
    }

    if (status === "disconnected") {
      channel.failedConnectionEvents += 1;
      maybeRotateProvider(channel);
      emitChannel(channel);
      return;
    }

    emitChannel(channel);
  });

  channel.provider.on("connection-error", () => {
    if (revision !== channel.providerRevision) {
      return;
    }

    channel.failedConnectionEvents += 1;
    maybeRotateProvider(channel);
    notifyIfCurrentProvider();
  });
}

function ensureChannel(roomCode: string): RoomChannel {
  const existing = channels.get(roomCode);
  if (existing) {
    return existing;
  }

  const doc = new Y.Doc();
  const provider = createProvider(WEBSOCKET_SERVERS[0], roomCode, doc);
  const events = doc.getArray<RoomEvent>("events");

  const channel: RoomChannel = {
    roomCode,
    doc,
    provider,
    providerRevision: 0,
    websocketServers: [...WEBSOCKET_SERVERS],
    activeServerIndex: 0,
    hasSyncedAtLeastOnce: false,
    failedConnectionEvents: 0,
    nextFailoverAllowedAt: 0,
    events,
    projectedState: null,
    projectedEventCount: 0,
    listeners: new Set(),
  };

  const notify = () => emitChannel(channel);
  events.observe(notify);
  bindProviderEvents(channel, channel.providerRevision);
  channels.set(roomCode, channel);

  return channel;
}

export function subscribeToRealtimeRoom(roomCode: string, listener: RoomListener): () => void {
  const channel = ensureChannel(roomCode);
  channel.listeners.add(listener);
  emitChannel(channel);

  return () => {
    channel.listeners.delete(listener);
  };
}

export function appendJoinEvent(roomCode: string, playerId: string, playerName: string): RoomState | null {
  const channel = ensureChannel(roomCode);
  const event: JoinEvent = {
    id: createEventId("join"),
    kind: "join",
    timestamp: Date.now(),
    playerId,
    playerName,
    initialBalance: ROOM_BALANCE_DEFAULTS.player,
  };

  channel.doc.transact(() => {
    channel.events.push([event]);
  });

  return projectChannelState(channel);
}

export function appendLeaveEvent(roomCode: string, playerId: string): RoomState | null {
  const channel = ensureChannel(roomCode);
  const event: LeaveEvent = {
    id: createEventId("leave"),
    kind: "leave",
    timestamp: Date.now(),
    playerId,
  };

  channel.doc.transact(() => {
    channel.events.push([event]);
  });

  return projectChannelState(channel);
}

export function appendOperationEvent(roomCode: string, payload: RoomOperationPayload): RoomState | null {
  const channel = ensureChannel(roomCode);
  const event: OperationEvent = {
    id: createEventId("operation"),
    kind: "operation",
    timestamp: Date.now(),
    payload: {
      type: payload.type,
      playerId: payload.playerId,
      amount: Math.floor(payload.amount),
      recipientPlayerId: payload.recipientPlayerId,
    },
  };

  channel.doc.transact(() => {
    channel.events.push([event]);
  });

  return projectChannelState(channel);
}

export function resetRealtimeRoom(roomCode: string): void {
  const channel = ensureChannel(roomCode);

  channel.doc.transact(() => {
    const totalEvents = channel.events.length;
    if (totalEvents > 0) {
      channel.events.delete(0, totalEvents);
    }
  });

  channel.projectedState = null;
  channel.projectedEventCount = 0;
}

export function getRealtimeRoomState(roomCode: string): RoomState | null {
  const channel = ensureChannel(roomCode);
  return projectChannelState(channel);
}
