import { RoomDomainError } from "@/src/domain/room/errors";
import { RoomOperationPayload, RoomState } from "@/src/domain/room/types";
import {
  appendJoinEvent,
  appendLeaveEvent,
  appendOperationEvent,
  getRealtimeRoomState,
  subscribeToRealtimeRoom,
} from "@/src/infrastructure/room/realtime-room-store";

const ROOM_CODE_PATTERN = /^\d{4}$/;

function normalizeRoomCode(rawValue: string): string {
  const prepared = rawValue.replace(/\D/g, "").slice(0, 4);
  if (prepared.length !== 4) {
    return rawValue.trim();
  }
  return prepared;
}

function assertRoomCode(rawValue: string): string {
  const code = normalizeRoomCode(rawValue);
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new RoomDomainError("Код комнаты должен быть формата 4 цифры.");
  }
  return code;
}

function createPlayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `player_${crypto.randomUUID()}`;
  }
  return `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateRoomCode(): string {
  return String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
}

export function joinRoom(playerName: string, roomCodeInput: string): {
  room: RoomState;
  roomCode: string;
  playerId: string;
} {
  const roomCode = assertRoomCode(roomCodeInput);
  const playerId = createPlayerId();

  const room = appendJoinEvent(roomCode, playerId, playerName.trim());

  if (!room) {
    throw new RoomDomainError("Не удалось открыть комнату.");
  }

  return { roomCode, playerId, room };
}

export function leaveRoom(roomCodeInput: string, playerId: string): RoomState | null {
  const roomCode = assertRoomCode(roomCodeInput);
  return appendLeaveEvent(roomCode, playerId);
}

export function executeRoomOperation(roomCodeInput: string, payload: RoomOperationPayload): RoomState {
  const roomCode = assertRoomCode(roomCodeInput);
  const room = appendOperationEvent(roomCode, payload);

  if (!room) {
    throw new RoomDomainError("Не удалось применить операцию.");
  }

  return room;
}

export function getRoom(roomCodeInput: string): RoomState | null {
  const roomCode = assertRoomCode(roomCodeInput);
  return getRealtimeRoomState(roomCode);
}

export function subscribeToRoom(roomCodeInput: string, listener: (room: RoomState | null) => void): () => void {
  const roomCode = assertRoomCode(roomCodeInput);
  return subscribeToRealtimeRoom(roomCode, listener);
}
