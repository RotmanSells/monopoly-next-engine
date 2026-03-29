import { RoomDomainError } from "@/src/domain/room/errors";
import {
  JoinRoomPayload,
  RoomOperationPayload,
  RoomOperationType,
  RoomPlayer,
  RoomState,
} from "@/src/domain/room/types";

export const ROOM_BALANCE_DEFAULTS = {
  bank: 20_000,
  player: 1_500,
  pool: 0,
};

const MAX_HISTORY_ITEMS = 80;

function nowOrFallback(provided?: number): number {
  return Number.isFinite(provided) ? Number(provided) : Date.now();
}

function clonePlayers(players: Record<string, RoomPlayer>): Record<string, RoomPlayer> {
  const cloned: Record<string, RoomPlayer> = {};

  for (const [id, player] of Object.entries(players)) {
    cloned[id] = { ...player };
  }

  return cloned;
}

function cloneRoomState(room: RoomState): RoomState {
  return {
    ...room,
    players: clonePlayers(room.players),
    history: room.history.map((item) => ({ ...item })),
  };
}

function sanitizePlayerName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();

  if (cleaned.length < 2) {
    throw new RoomDomainError("Имя игрока должно содержать минимум 2 символа.");
  }

  if (cleaned.length > 18) {
    throw new RoomDomainError("Имя игрока должно быть не длиннее 18 символов.");
  }

  return cleaned;
}

function assertPositiveAmount(amount: number): number {
  const normalized = Math.floor(amount);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new RoomDomainError("Сумма операции должна быть положительным числом.");
  }

  return normalized;
}

function assertOperationPlayer(room: RoomState, playerId: string): RoomPlayer {
  const player = room.players[playerId];
  if (!player) {
    throw new RoomDomainError("Игрок для операции не найден в комнате.");
  }
  return player;
}

function assertEnoughRoomBalance(balance: number, amount: number, source: string): void {
  if (balance < amount) {
    throw new RoomDomainError(`Недостаточно средств в ${source}.`);
  }
}

function operationTitle(type: RoomOperationType): string {
  switch (type) {
    case "add":
      return "Пополнение";
    case "remove":
      return "Снятие";
    case "transfer":
      return "Перевод";
    case "toBank":
      return "В банк";
    case "fromBank":
      return "Из банка";
    case "toPool":
      return "В общак";
    case "fromPool":
      return "Из общака";
    default:
      return "Операция";
  }
}

export function createRoomState(roomCode: string, timestamp?: number): RoomState {
  const now = nowOrFallback(timestamp);

  return {
    roomCode,
    bank: ROOM_BALANCE_DEFAULTS.bank,
    pool: ROOM_BALANCE_DEFAULTS.pool,
    players: {},
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addPlayerToRoom(room: RoomState, payload: JoinRoomPayload): RoomState {
  const { playerId } = payload;
  const playerName = sanitizePlayerName(payload.playerName);
  const timestamp = nowOrFallback(payload.now);
  const initialBalance = Number.isFinite(payload.initialBalance)
    ? Number(payload.initialBalance)
    : ROOM_BALANCE_DEFAULTS.player;

  const nextRoom = cloneRoomState(room);
  const existingPlayer = nextRoom.players[playerId];

  nextRoom.players[playerId] = {
    id: playerId,
    name: playerName,
    balance: existingPlayer ? existingPlayer.balance : initialBalance,
    joinedAt: existingPlayer ? existingPlayer.joinedAt : timestamp,
  };
  nextRoom.updatedAt = timestamp;

  return nextRoom;
}

export function removePlayerFromRoom(room: RoomState, playerId: string, timestamp?: number): RoomState {
  const nextRoom = cloneRoomState(room);
  delete nextRoom.players[playerId];
  nextRoom.updatedAt = nowOrFallback(timestamp);
  return nextRoom;
}

export function applyRoomOperation(room: RoomState, payload: RoomOperationPayload): RoomState {
  const amount = assertPositiveAmount(payload.amount);
  const nextRoom = cloneRoomState(room);
  const currentPlayer = assertOperationPlayer(nextRoom, payload.playerId);
  const timestamp = nowOrFallback(payload.now);

  switch (payload.type) {
    case "add":
      currentPlayer.balance += amount;
      break;
    case "remove":
      currentPlayer.balance -= amount;
      break;
    case "transfer": {
      if (!payload.recipientPlayerId) {
        throw new RoomDomainError("Для перевода нужно выбрать получателя.");
      }
      if (payload.recipientPlayerId === payload.playerId) {
        throw new RoomDomainError("Нельзя перевести деньги самому себе.");
      }
      const recipient = assertOperationPlayer(nextRoom, payload.recipientPlayerId);
      currentPlayer.balance -= amount;
      recipient.balance += amount;
      break;
    }
    case "toBank":
      currentPlayer.balance -= amount;
      nextRoom.bank += amount;
      break;
    case "fromBank":
      assertEnoughRoomBalance(nextRoom.bank, amount, "банке");
      currentPlayer.balance += amount;
      nextRoom.bank -= amount;
      break;
    case "toPool":
      currentPlayer.balance -= amount;
      nextRoom.pool += amount;
      break;
    case "fromPool":
      assertEnoughRoomBalance(nextRoom.pool, amount, "общаке");
      currentPlayer.balance += amount;
      nextRoom.pool -= amount;
      break;
    default:
      throw new RoomDomainError("Неизвестный тип операции.");
  }

  nextRoom.history = [
    {
      id: `${timestamp}-${payload.playerId}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      type: payload.type,
      description: operationTitle(payload.type),
      amount,
      playerId: payload.playerId,
      recipientPlayerId: payload.recipientPlayerId,
    },
    ...nextRoom.history,
  ].slice(0, MAX_HISTORY_ITEMS);
  nextRoom.updatedAt = timestamp;

  return nextRoom;
}
