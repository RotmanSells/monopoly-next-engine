import { RoomOperationType, RoomState } from "@/src/domain/room/types";

const ROOM_STORAGE_PREFIX = "monopoly-room:";
const SYNC_CHANNEL_NAME = "monopoly-room-sync";

type RoomListener = (room: RoomState | null) => void;
type RoomUpdater = (current: RoomState | null) => RoomState | null;

const listenersByRoom = new Map<string, Set<RoomListener>>();
let storageEventsBound = false;
let channel: BroadcastChannel | null = null;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeOperationType(value: unknown): RoomOperationType {
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
      return "add";
  }
}

function parseRoomState(roomCode: string, unknownRoom: unknown): RoomState | null {
  if (!isObjectRecord(unknownRoom)) {
    return null;
  }

  const playersUnknown = unknownRoom.players;
  const historyUnknown = unknownRoom.history;

  if (!isObjectRecord(playersUnknown) || !Array.isArray(historyUnknown)) {
    return null;
  }

  const players: RoomState["players"] = {};
  for (const [playerId, unknownPlayer] of Object.entries(playersUnknown)) {
    if (!isObjectRecord(unknownPlayer)) {
      continue;
    }

    players[playerId] = {
      id: normalizeString(unknownPlayer.id, playerId),
      name: normalizeString(unknownPlayer.name, "Игрок"),
      balance: normalizeNumber(unknownPlayer.balance),
      joinedAt: normalizeNumber(unknownPlayer.joinedAt, Date.now()),
    };
  }

  const history = historyUnknown
    .map((unknownItem) => {
      if (!isObjectRecord(unknownItem)) {
        return null;
      }

      return {
        id: normalizeString(unknownItem.id, `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        timestamp: normalizeNumber(unknownItem.timestamp, Date.now()),
        type: normalizeOperationType(unknownItem.type),
        description: normalizeString(unknownItem.description, "Операция"),
        amount: normalizeNumber(unknownItem.amount),
        playerId: normalizeString(unknownItem.playerId),
        recipientPlayerId: normalizeString(unknownItem.recipientPlayerId) || undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    roomCode,
    bank: normalizeNumber(unknownRoom.bank),
    pool: normalizeNumber(unknownRoom.pool),
    players,
    history,
    createdAt: normalizeNumber(unknownRoom.createdAt, Date.now()),
    updatedAt: normalizeNumber(unknownRoom.updatedAt, Date.now()),
  };
}

function ensureBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function roomStorageKey(roomCode: string): string {
  return `${ROOM_STORAGE_PREFIX}${roomCode}`;
}

function bindExternalEvents(): void {
  if (!ensureBrowser() || storageEventsBound) {
    return;
  }

  storageEventsBound = true;
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.startsWith(ROOM_STORAGE_PREFIX)) {
      return;
    }
    const roomCode = event.key.replace(ROOM_STORAGE_PREFIX, "");
    emitRoom(roomCode, false);
  });

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    channel.addEventListener("message", (event: MessageEvent<{ roomCode?: string }>) => {
      if (!event.data?.roomCode) {
        return;
      }
      emitRoom(event.data.roomCode, false);
    });
  }
}

function emitRoom(roomCode: string, shouldBroadcast: boolean): void {
  const roomListeners = listenersByRoom.get(roomCode);
  if (roomListeners) {
    const room = loadRoomState(roomCode);
    roomListeners.forEach((listener) => listener(room));
  }

  if (shouldBroadcast && channel) {
    channel.postMessage({ roomCode });
  }
}

export function loadRoomState(roomCode: string): RoomState | null {
  if (!ensureBrowser()) {
    return null;
  }

  const rawData = localStorage.getItem(roomStorageKey(roomCode));
  if (!rawData) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawData) as unknown;
    return parseRoomState(roomCode, parsed);
  } catch {
    return null;
  }
}

export function saveRoomState(roomCode: string, room: RoomState): void {
  if (!ensureBrowser()) {
    return;
  }

  localStorage.setItem(roomStorageKey(roomCode), JSON.stringify(room));
  emitRoom(roomCode, true);
}

export function updateRoomState(roomCode: string, updater: RoomUpdater): RoomState | null {
  const current = loadRoomState(roomCode);
  const next = updater(current);

  if (!ensureBrowser()) {
    return next;
  }

  if (next === null) {
    localStorage.removeItem(roomStorageKey(roomCode));
    emitRoom(roomCode, true);
    return null;
  }

  saveRoomState(roomCode, next);
  return next;
}

export function subscribeToRoomState(roomCode: string, listener: RoomListener): () => void {
  bindExternalEvents();

  if (!listenersByRoom.has(roomCode)) {
    listenersByRoom.set(roomCode, new Set());
  }

  const roomListeners = listenersByRoom.get(roomCode);
  if (!roomListeners) {
    return () => undefined;
  }

  roomListeners.add(listener);
  listener(loadRoomState(roomCode));

  return () => {
    const listeners = listenersByRoom.get(roomCode);
    if (!listeners) {
      return;
    }

    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByRoom.delete(roomCode);
    }
  };
}
