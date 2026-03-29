"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { RoomDomainError } from "@/src/domain/room/errors";
import { RoomOperationType, RoomPlayer, RoomState } from "@/src/domain/room/types";
import {
  executeRoomOperation,
  generateRoomCode,
  joinRoom,
  leaveRoom,
  subscribeToRoom,
} from "@/src/application/room/room-engine";
import styles from "@/src/ui/components/monopoly-room-app.module.css";

const SESSION_STORAGE_KEY = "monopoly-room-session";

type SessionPayload = {
  roomCode: string;
  playerId: string;
  playerName: string;
};

type RoomTab = "overview" | "players" | "actions" | "history";

function parseAmount(value: string): number {
  return Number.parseInt(value.replace(/[^\d]/g, ""), 10);
}

function operationSign(type: RoomOperationType): "+" | "-" {
  return type === "add" || type === "fromBank" || type === "fromPool" ? "+" : "-";
}

function getPlayerById(room: RoomState | null, playerId: string): RoomPlayer | null {
  if (!room) {
    return null;
  }
  return room.players[playerId] ?? null;
}

function persistSession(payload: SessionPayload | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (payload === null) {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function loadSession(): SessionPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!rawPayload) {
    return null;
  }

  try {
    const unknownPayload = JSON.parse(rawPayload) as unknown;
    if (
      typeof unknownPayload === "object" &&
      unknownPayload !== null &&
      "roomCode" in unknownPayload &&
      "playerId" in unknownPayload &&
      "playerName" in unknownPayload
    ) {
      return unknownPayload as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("ru-RU")}`;
}

function mapDomainError(error: unknown): string {
  if (error instanceof RoomDomainError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Произошла непредвиденная ошибка.";
}

function operationTitle(type: RoomOperationType): string {
  switch (type) {
    case "add":
      return "Пополнение";
    case "remove":
      return "Списание";
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

function tabTitle(tab: RoomTab): string {
  switch (tab) {
    case "overview":
      return "Обзор";
    case "players":
      return "Игроки";
    case "actions":
      return "Действия";
    case "history":
      return "История";
    default:
      return "Обзор";
  }
}

const TABS: RoomTab[] = ["overview", "players", "actions", "history"];
const OPERATION_TYPES: RoomOperationType[] = [
  "add",
  "remove",
  "transfer",
  "toBank",
  "fromBank",
  "toPool",
  "fromPool",
];

export function MonopolyRoomApp() {
  const [roomCodeInput, setRoomCodeInput] = useState(() => generateRoomCode());
  const [playerNameInput, setPlayerNameInput] = useState("");

  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [currentPlayerName, setCurrentPlayerName] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);

  const [activeTab, setActiveTab] = useState<RoomTab>("overview");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [selectedOperationType, setSelectedOperationType] = useState<RoomOperationType>("add");
  const [amountInput, setAmountInput] = useState("100");
  const [recipientPlayerId, setRecipientPlayerId] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const currentPlayer = useMemo(
    () => (currentPlayerId ? getPlayerById(roomState, currentPlayerId) : null),
    [currentPlayerId, roomState],
  );

  const players = useMemo(() => Object.values(roomState?.players ?? {}), [roomState]);

  const activeOperationPlayerId = useMemo(() => {
    if (!roomState) {
      return "";
    }

    if (selectedPlayerId && roomState.players[selectedPlayerId]) {
      return selectedPlayerId;
    }

    if (currentPlayerId && roomState.players[currentPlayerId]) {
      return currentPlayerId;
    }

    const fallback = Object.keys(roomState.players)[0];
    return fallback ?? "";
  }, [currentPlayerId, roomState, selectedPlayerId]);

  const activeOperationPlayer = useMemo(
    () => (activeOperationPlayerId ? roomState?.players[activeOperationPlayerId] : null),
    [activeOperationPlayerId, roomState],
  );

  const recipients = useMemo(() => {
    if (!roomState || selectedOperationType !== "transfer" || !activeOperationPlayerId) {
      return [];
    }
    return Object.values(roomState.players).filter((player) => player.id !== activeOperationPlayerId);
  }, [activeOperationPlayerId, roomState, selectedOperationType]);

  const visiblePlayers = useMemo(() => players.slice(0, 6), [players]);
  const hiddenPlayersCount = Math.max(0, players.length - visiblePlayers.length);

  const visibleHistory = useMemo(() => (roomState?.history ?? []).slice(0, 6), [roomState?.history]);
  const hiddenHistoryCount = Math.max(0, (roomState?.history.length ?? 0) - visibleHistory.length);

  const resetTransientMessages = useCallback(() => {
    setMessage(null);
    setErrorText(null);
  }, []);

  useEffect(() => {
    if (!activeRoomCode || !currentPlayerId) {
      return;
    }

    const unsubscribe = subscribeToRoom(activeRoomCode, (nextRoom) => {
      setRoomState(nextRoom);

      if (!nextRoom) {
        setErrorText("Комната больше недоступна.");
        return;
      }

      if (!nextRoom.players[currentPlayerId]) {
        setErrorText("Ваш профиль удалён из комнаты. Перезайдите.");
        persistSession(null);
        setActiveRoomCode(null);
        setCurrentPlayerId(null);
        setCurrentPlayerName(null);
      }
    });

    return unsubscribe;
  }, [activeRoomCode, currentPlayerId]);

  useEffect(() => {
    const savedSession = loadSession();
    if (!savedSession) {
      return;
    }

    startTransition(() => {
      setActiveRoomCode(savedSession.roomCode);
      setCurrentPlayerId(savedSession.playerId);
      setCurrentPlayerName(savedSession.playerName);
    });
  }, []);

  useEffect(() => {
    if (!activeRoomCode || !currentPlayerId) {
      return;
    }

    const handleUnload = () => {
      leaveRoom(activeRoomCode, currentPlayerId);
      persistSession(null);
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [activeRoomCode, currentPlayerId]);

  const handleJoinRoom = useCallback(() => {
    resetTransientMessages();

    try {
      const { roomCode, playerId, room } = joinRoom(playerNameInput, roomCodeInput);
      setActiveRoomCode(roomCode);
      setCurrentPlayerId(playerId);
      setCurrentPlayerName(playerNameInput.trim());
      setRoomState(room);
      setSelectedPlayerId(playerId);
      setActiveTab("overview");
      persistSession({
        roomCode,
        playerId,
        playerName: playerNameInput.trim(),
      });
      setMessage(`Вы вошли в комнату ${roomCode}`);
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [playerNameInput, resetTransientMessages, roomCodeInput]);

  const handleLeaveRoom = useCallback(() => {
    if (!activeRoomCode || !currentPlayerId) {
      return;
    }

    leaveRoom(activeRoomCode, currentPlayerId);
    persistSession(null);
    setActiveRoomCode(null);
    setCurrentPlayerId(null);
    setCurrentPlayerName(null);
    setRoomState(null);
    setSelectedPlayerId("");
    setSelectedOperationType("add");
    setRecipientPlayerId("");
    setAmountInput("100");
    setRoomCodeInput(generateRoomCode());
    setMessage("Вы вышли из комнаты.");
  }, [activeRoomCode, currentPlayerId]);

  const handleCopyRoomCode = useCallback(() => {
    if (!activeRoomCode || !navigator.clipboard) {
      return;
    }
    navigator.clipboard
      .writeText(activeRoomCode)
      .then(() => setMessage("Код комнаты скопирован."))
      .catch(() => setErrorText("Не удалось скопировать код."));
  }, [activeRoomCode]);

  const jumpToAction = useCallback((playerId: string, type?: RoomOperationType) => {
    setSelectedPlayerId(playerId);
    if (type) {
      setSelectedOperationType(type);
    }
    setActiveTab("actions");
    setErrorText(null);
  }, []);

  const handleOperationSubmit = useCallback(() => {
    if (!activeRoomCode || !activeOperationPlayerId) {
      return;
    }

    const amount = parseAmount(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorText("Введите корректную положительную сумму.");
      return;
    }

    if (selectedOperationType === "transfer" && !recipientPlayerId) {
      setErrorText("Выберите получателя для перевода.");
      return;
    }

    try {
      executeRoomOperation(activeRoomCode, {
        type: selectedOperationType,
        playerId: activeOperationPlayerId,
        amount,
        recipientPlayerId: selectedOperationType === "transfer" ? recipientPlayerId : undefined,
      });
      setMessage(`Операция "${operationTitle(selectedOperationType)}" выполнена.`);
      setErrorText(null);
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [
    activeOperationPlayerId,
    activeRoomCode,
    amountInput,
    recipientPlayerId,
    selectedOperationType,
  ]);

  if (!activeRoomCode || !currentPlayerId || !roomState) {
    return (
      <main className={styles.page}>
        <section className={styles.loginCard}>
          <p className={styles.badge}>Neon Room</p>
          <h1 className={styles.title}>Monopoly Engine</h1>
          <p className={styles.subtitle}>
            Вход в realtime-комнату. После подключения игроки появляются автоматически.
          </p>

          <div className={styles.formGroup}>
            <label htmlFor="room-code">Код комнаты</label>
            <div className={styles.inlineActions}>
              <input
                id="room-code"
                className={styles.input}
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value)}
                placeholder="ABC-123"
                maxLength={7}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setRoomCodeInput(generateRoomCode())}
              >
                Новый
              </button>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="player-name">Имя игрока</label>
            <input
              id="player-name"
              className={styles.input}
              value={playerNameInput}
              onChange={(event) => setPlayerNameInput(event.target.value)}
              placeholder="Например, Андрей"
              maxLength={18}
            />
          </div>

          <button type="button" className={styles.primaryButton} onClick={handleJoinRoom}>
            Войти в игру
          </button>

          {errorText && <p className={styles.errorText}>{errorText}</p>}
          {message && <p className={styles.messageText}>{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.roomShell}>
        <header className={styles.topBar}>
          <div>
            <p className={styles.badge}>Комната</p>
            <h1 className={styles.roomCode}>{activeRoomCode}</h1>
            <p className={styles.roomMeta}>
              Игрок: <strong>{currentPlayerName}</strong>
            </p>
          </div>
          <div className={styles.topActions}>
            <button type="button" className={styles.secondaryButton} onClick={handleCopyRoomCode}>
              Код
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handleLeaveRoom}>
              Выйти
            </button>
          </div>
        </header>

        <section className={styles.statsGrid}>
          <article className={styles.statCard}>
            <span>Банк</span>
            <strong>{formatMoney(roomState.bank)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Общак</span>
            <strong>{formatMoney(roomState.pool)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Мой баланс</span>
            <strong>{currentPlayer ? formatMoney(currentPlayer.balance) : "—"}</strong>
          </article>
        </section>

        <section className={styles.tabBody}>
          <div className={styles.tabHeader}>
            <h2>{tabTitle(activeTab)}</h2>
            {activeTab === "players" && hiddenPlayersCount > 0 && <span>+{hiddenPlayersCount} игроков</span>}
            {activeTab === "history" && hiddenHistoryCount > 0 && <span>+{hiddenHistoryCount} записей</span>}
          </div>

          {activeTab === "overview" && (
            <div className={styles.overviewGrid}>
              <button type="button" className={styles.neonCard} onClick={() => jumpToAction(currentPlayerId, "add")}>
                <span>Быстрое действие</span>
                <strong>Пополнить себя</strong>
              </button>
              <button
                type="button"
                className={styles.neonCard}
                onClick={() => jumpToAction(currentPlayerId, "toBank")}
              >
                <span>Быстрое действие</span>
                <strong>Перевести в банк</strong>
              </button>
              <button
                type="button"
                className={styles.neonCard}
                onClick={() => jumpToAction(currentPlayerId, "toPool")}
              >
                <span>Быстрое действие</span>
                <strong>Скинуть в общак</strong>
              </button>
              <button type="button" className={styles.neonCard} onClick={() => setActiveTab("players")}>
                <span>Навигация</span>
                <strong>Открыть список игроков</strong>
              </button>
            </div>
          )}

          {activeTab === "players" && (
            <div className={styles.playersGrid}>
              {visiblePlayers.map((player) => (
                <article key={player.id} className={styles.playerCard}>
                  <div>
                    <h3>{player.name}</h3>
                    <p>{formatMoney(player.balance)}</p>
                  </div>
                  <div className={styles.inlineActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => jumpToAction(player.id, "add")}>
                      +$
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => jumpToAction(player.id, "transfer")}
                    >
                      →
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeTab === "actions" && (
            <div className={styles.actionsStack}>
              <div className={styles.formGroup}>
                <label>Игрок</label>
                <div className={styles.playerSwitch}>
                  {players.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      className={`${styles.switchChip} ${
                        player.id === activeOperationPlayerId ? styles.switchChipActive : ""
                      }`}
                      onClick={() => setSelectedPlayerId(player.id)}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Тип операции</label>
                <div className={styles.operationGrid}>
                  {OPERATION_TYPES.map((operationType) => (
                    <button
                      key={operationType}
                      type="button"
                      className={`${styles.switchChip} ${
                        selectedOperationType === operationType ? styles.switchChipActive : ""
                      }`}
                      onClick={() => setSelectedOperationType(operationType)}
                    >
                      {operationTitle(operationType)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="amount">Сумма</label>
                <input
                  id="amount"
                  className={styles.input}
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  inputMode="numeric"
                />
                <div className={styles.inlineActions}>
                  {[100, 500, 1000, 5000].map((quickAmount) => (
                    <button
                      key={quickAmount}
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setAmountInput(String(quickAmount))}
                    >
                      {quickAmount}
                    </button>
                  ))}
                </div>
              </div>

              {selectedOperationType === "transfer" && (
                <div className={styles.formGroup}>
                  <label htmlFor="recipient">Получатель</label>
                  <select
                    id="recipient"
                    className={styles.input}
                    value={recipientPlayerId}
                    onChange={(event) => setRecipientPlayerId(event.target.value)}
                  >
                    <option value="">Выберите игрока</option>
                    {recipients.map((recipient) => (
                      <option key={recipient.id} value={recipient.id}>
                        {recipient.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button type="button" className={styles.primaryButton} onClick={handleOperationSubmit}>
                Выполнить: {operationTitle(selectedOperationType)}
                {activeOperationPlayer ? ` (${activeOperationPlayer.name})` : ""}
              </button>
            </div>
          )}

          {activeTab === "history" && (
            <ul className={styles.historyList}>
              {visibleHistory.length === 0 && <li className={styles.emptyState}>Операций пока нет.</li>}
              {visibleHistory.map((item) => (
                <li key={item.id} className={styles.historyItem}>
                  <div>
                    <p>{item.description}</p>
                    <span>{new Date(item.timestamp).toLocaleTimeString("ru-RU")}</span>
                  </div>
                  <strong>
                    {operationSign(item.type)}
                    {formatMoney(item.amount)}
                  </strong>
                </li>
              ))}
            </ul>
          )}

          {message && <p className={styles.messageText}>{message}</p>}
          {errorText && <p className={styles.errorText}>{errorText}</p>}
        </section>

        <nav className={styles.bottomMenu}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${styles.bottomMenuItem} ${activeTab === tab ? styles.bottomMenuItemActive : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabTitle(tab)}
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
