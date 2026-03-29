import { describe, expect, it } from "vitest";
import {
  addPlayerToRoom,
  applyRoomOperation,
  createRoomState,
  removePlayerFromRoom,
} from "./room-rules";

describe("room-rules", () => {
  it("creates a room with defaults", () => {
    const room = createRoomState("1234", 1000);

    expect(room.roomCode).toBe("1234");
    expect(room.bank).toBe(20_000);
    expect(room.pool).toBe(0);
    expect(room.history).toHaveLength(0);
  });

  it("adds and removes players", () => {
    const room = createRoomState("1234", 1000);
    const withPlayer = addPlayerToRoom(room, {
      playerId: "player_1",
      playerName: "Алексей",
      now: 1100,
    });

    expect(withPlayer.players.player_1.name).toBe("Алексей");
    expect(withPlayer.players.player_1.balance).toBe(1500);

    const withoutPlayer = removePlayerFromRoom(withPlayer, "player_1", 1200);
    expect(withoutPlayer.players.player_1).toBeUndefined();
  });

  it("executes transfer operation and updates history", () => {
    let room = createRoomState("1234", 1000);
    room = addPlayerToRoom(room, { playerId: "p1", playerName: "Игрок 1", now: 1001 });
    room = addPlayerToRoom(room, { playerId: "p2", playerName: "Игрок 2", now: 1002 });

    const nextRoom = applyRoomOperation(room, {
      type: "transfer",
      playerId: "p1",
      recipientPlayerId: "p2",
      amount: 250,
      now: 1200,
    });

    expect(nextRoom.players.p1.balance).toBe(1250);
    expect(nextRoom.players.p2.balance).toBe(1750);
    expect(nextRoom.history[0].type).toBe("transfer");
    expect(nextRoom.history[0].amount).toBe(250);
  });
});
