import { RoomDomainError } from "@/src/domain/room/errors";
import {
  addPlayerToRoom,
  applyRoomOperation,
  createRoomState,
  removePlayerFromRoom,
} from "@/src/domain/room/room-rules";
import { RoomOperationPayload, RoomState } from "@/src/domain/room/types";
import {
  loadRoomState,
  subscribeToRoomState,
  updateRoomState,
} from "@/src/infrastructure/room/local-room-store";

const ROOM_CODE_PATTERN = /^[A-Z2-9]{3}-[A-Z2-9]{3}$/;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeRoomCode(rawValue: string): string {
  const prepared = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (prepared.length !== 6) {
    return rawValue.toUpperCase().trim();
  }
  return `${prepared.slice(0, 3)}-${prepared.slice(3)}`;
}

function assertRoomCode(rawValue: string): string {
  const code = normalizeRoomCode(rawValue);
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new RoomDomainError("Код комнаты должен быть формата XXX-XXX.");
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
  let first = "";
  let second = "";

  for (let index = 0; index < 3; index += 1) {
    first += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    second += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }

  return `${first}-${second}`;
}

export function joinRoom(playerName: string, roomCodeInput: string): {
  room: RoomState;
  roomCode: string;
  playerId: string;
} {
  const roomCode = assertRoomCode(roomCodeInput);
  const playerId = createPlayerId();

  const room = updateRoomState(roomCode, (current) => {
    const base = current ?? createRoomState(roomCode);
    return addPlayerToRoom(base, {
      playerId,
      playerName,
    });
  });

  if (!room) {
    throw new RoomDomainError("Не удалось открыть комнату.");
  }

  return { roomCode, playerId, room };
}

export function leaveRoom(roomCodeInput: string, playerId: string): RoomState | null {
  const roomCode = assertRoomCode(roomCodeInput);
  return updateRoomState(roomCode, (current) => {
    if (!current) {
      return null;
    }
    return removePlayerFromRoom(current, playerId);
  });
}

export function executeRoomOperation(roomCodeInput: string, payload: RoomOperationPayload): RoomState {
  const roomCode = assertRoomCode(roomCodeInput);
  const room = updateRoomState(roomCode, (current) => {
    if (!current) {
      throw new RoomDomainError("Комната не найдена.");
    }
    return applyRoomOperation(current, payload);
  });

  if (!room) {
    throw new RoomDomainError("Не удалось применить операцию.");
  }

  return room;
}

export function getRoom(roomCodeInput: string): RoomState | null {
  const roomCode = assertRoomCode(roomCodeInput);
  return loadRoomState(roomCode);
}

export function subscribeToRoom(roomCodeInput: string, listener: (room: RoomState | null) => void): () => void {
  const roomCode = assertRoomCode(roomCodeInput);
  return subscribeToRoomState(roomCode, listener);
}
