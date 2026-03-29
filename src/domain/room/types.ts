export type RoomOperationType =
  | "add"
  | "remove"
  | "transfer"
  | "toBank"
  | "fromBank"
  | "toPool"
  | "fromPool";

export type RoomHistoryItem = {
  id: string;
  timestamp: number;
  type: RoomOperationType;
  description: string;
  amount: number;
  playerId: string;
  recipientPlayerId?: string;
};

export type RoomPlayer = {
  id: string;
  name: string;
  balance: number;
  joinedAt: number;
};

export type RoomState = {
  roomCode: string;
  bank: number;
  pool: number;
  players: Record<string, RoomPlayer>;
  history: RoomHistoryItem[];
  createdAt: number;
  updatedAt: number;
};

export type JoinRoomPayload = {
  playerId: string;
  playerName: string;
  initialBalance?: number;
  now?: number;
};

export type RoomOperationPayload = {
  type: RoomOperationType;
  playerId: string;
  amount: number;
  recipientPlayerId?: string;
  now?: number;
};
