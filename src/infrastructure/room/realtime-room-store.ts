import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { RoomDomainError } from "@/src/domain/room/errors";
import {
  addPlayerToRoom,
  applyRoomOperation,
  createRoomState,
  removePlayerFromRoom,
  ROOM_BALANCE_DEFAULTS,
} from "@/src/domain/room/room-rules";
import { RoomOperationPayload, RoomOperationType, RoomState } from "@/src/domain/room/types";

const DEFAULT_SIGNALING_SERVERS = ["wss://signaling.yjs.dev"];

function resolveSignalingServers(): string[] {
  const configured = process.env.NEXT_PUBLIC_YJS_SIGNALING_SERVERS;
  if (!configured) {
    return DEFAULT_SIGNALING_SERVERS;
  }

  const parsed = configured
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return parsed.length > 0 ? parsed : DEFAULT_SIGNALING_SERVERS;
}

const SIGNALING_SERVERS = resolveSignalingServers();

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
  provider: WebrtcProvider;
  events: Y.Array<RoomEvent>;
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

function buildRoomStateFromEvents(roomCode: string, events: RoomEvent[]): RoomState | null {
  if (events.length === 0) {
    return null;
  }

  let room = createRoomState(roomCode, events[0].timestamp);

  for (const event of events) {
    if (event.kind === "join") {
      room = addPlayerToRoom(room, {
        playerId: event.playerId,
        playerName: event.playerName,
        initialBalance: event.initialBalance,
        now: event.timestamp,
      });
      continue;
    }

    if (event.kind === "leave") {
      room = removePlayerFromRoom(room, event.playerId, event.timestamp);
      continue;
    }

    try {
      room = applyRoomOperation(room, {
        type: event.payload.type,
        playerId: event.payload.playerId,
        amount: event.payload.amount,
        recipientPlayerId: event.payload.recipientPlayerId,
        now: event.timestamp,
      });
    } catch (error) {
      if (error instanceof RoomDomainError) {
        continue;
      }
      throw error;
    }
  }

  return room;
}

function emitChannel(channel: RoomChannel): void {
  const parsedEvents = channel.events
    .toArray()
    .map((event) => parseRoomEvent(event))
    .filter((event): event is RoomEvent => event !== null);

  const state = buildRoomStateFromEvents(channel.roomCode, parsedEvents);
  channel.listeners.forEach((listener) => listener(state));
}

function ensureChannel(roomCode: string): RoomChannel {
  const existing = channels.get(roomCode);
  if (existing) {
    return existing;
  }

  const doc = new Y.Doc();
  const provider = new WebrtcProvider(channelName(roomCode), doc, {
    signaling: SIGNALING_SERVERS,
  });
  const events = doc.getArray<RoomEvent>("events");

  const channel: RoomChannel = {
    roomCode,
    doc,
    provider,
    events,
    listeners: new Set(),
  };

  const notify = () => emitChannel(channel);
  events.observe(notify);
  provider.on("synced", notify);
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

  const parsedEvents = channel.events
    .toArray()
    .map((rawEvent) => parseRoomEvent(rawEvent))
    .filter((parsed): parsed is RoomEvent => parsed !== null);
  return buildRoomStateFromEvents(roomCode, parsedEvents);
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

  const parsedEvents = channel.events
    .toArray()
    .map((rawEvent) => parseRoomEvent(rawEvent))
    .filter((parsed): parsed is RoomEvent => parsed !== null);
  return buildRoomStateFromEvents(roomCode, parsedEvents);
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

  const parsedEvents = channel.events
    .toArray()
    .map((rawEvent) => parseRoomEvent(rawEvent))
    .filter((parsed): parsed is RoomEvent => parsed !== null);
  return buildRoomStateFromEvents(roomCode, parsedEvents);
}

export function getRealtimeRoomState(roomCode: string): RoomState | null {
  const channel = ensureChannel(roomCode);
  const parsedEvents = channel.events
    .toArray()
    .map((rawEvent) => parseRoomEvent(rawEvent))
    .filter((parsed): parsed is RoomEvent => parsed !== null);
  return buildRoomStateFromEvents(roomCode, parsedEvents);
}
