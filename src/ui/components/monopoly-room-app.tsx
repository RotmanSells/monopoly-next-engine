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

type DialogState = {
  type: RoomOperationType;
  playerId: string;
};

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
      const typedPayload = unknownPayload as SessionPayload;
      return typedPayload;
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
      return "Пополнить";
    case "remove":
      return "Снять";
    case "transfer":
      return "Перевести";
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

export function MonopolyRoomApp() {
  const [roomCodeInput, setRoomCodeInput] = useState(() => generateRoomCode());
  const [playerNameInput, setPlayerNameInput] = useState("");

  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [currentPlayerName, setCurrentPlayerName] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [amountInput, setAmountInput] = useState("100");
  const [recipientPlayerId, setRecipientPlayerId] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const currentPlayer = useMemo(
    () => (currentPlayerId ? getPlayerById(roomState, currentPlayerId) : null),
    [currentPlayerId, roomState],
  );

  const recipients = useMemo(() => {
    if (!roomState || !dialog || dialog.type !== "transfer") {
      return [];
    }
    return Object.values(roomState.players).filter((player) => player.id !== dialog.playerId);
  }, [dialog, roomState]);

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
    setDialog(null);
    setRecipientPlayerId("");
    setAmountInput("100");
    setRoomCodeInput(generateRoomCode());
    setMessage("Вы вышли из комнаты.");
  }, [activeRoomCode, currentPlayerId]);

  const openOperationDialog = useCallback((type: RoomOperationType, playerId: string) => {
    setDialog({ type, playerId });
    setAmountInput("100");
    setRecipientPlayerId("");
    setErrorText(null);
  }, []);

  const closeOperationDialog = useCallback(() => {
    setDialog(null);
    setAmountInput("100");
    setRecipientPlayerId("");
  }, []);

  const handleOperationSubmit = useCallback(() => {
    if (!dialog || !activeRoomCode) {
      return;
    }

    const amount = parseAmount(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorText("Введите корректную положительную сумму.");
      return;
    }

    try {
      executeRoomOperation(activeRoomCode, {
        type: dialog.type,
        playerId: dialog.playerId,
        amount,
        recipientPlayerId: dialog.type === "transfer" ? recipientPlayerId : undefined,
      });
      setMessage(`Операция "${operationTitle(dialog.type)}" выполнена.`);
      closeOperationDialog();
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [activeRoomCode, amountInput, closeOperationDialog, dialog, recipientPlayerId]);

  const handleCopyRoomCode = useCallback(() => {
    if (!activeRoomCode || !navigator.clipboard) {
      return;
    }
    navigator.clipboard
      .writeText(activeRoomCode)
      .then(() => setMessage("Код комнаты скопирован."))
      .catch(() => setErrorText("Не удалось скопировать код."));
  }, [activeRoomCode]);

  if (!activeRoomCode || !currentPlayerId || !roomState) {
    return (
      <main className={styles.page}>
        <section className={styles.loginCard}>
          <p className={styles.badge}>Monopoly PWA</p>
          <h1 className={styles.title}>Комнатный движок</h1>
          <p className={styles.subtitle}>
            Локальная комната с синхронизацией между вкладками. Подходит для быстрых игр и офлайн-сценариев.
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
                className={styles.ghostButton}
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
            Войти в комнату
          </button>

          {errorText && <p className={styles.errorText}>{errorText}</p>}
          {message && <p className={styles.messageText}>{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.roomPanel}>
        <header className={styles.header}>
          <div>
            <p className={styles.badge}>Комната</p>
            <h1 className={styles.roomTitle}>{activeRoomCode}</h1>
            <p className={styles.roomMeta}>
              Игрок: <strong>{currentPlayerName}</strong>
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.ghostButton} onClick={handleCopyRoomCode}>
              Копировать код
            </button>
            <button type="button" className={styles.ghostButton} onClick={handleLeaveRoom}>
              Выйти
            </button>
          </div>
        </header>

        <section className={styles.fundsGrid}>
          <article className={styles.fundCard}>
            <h2>Банк</h2>
            <p>{formatMoney(roomState.bank)}</p>
          </article>
          <article className={styles.fundCard}>
            <h2>Общак</h2>
            <p>{formatMoney(roomState.pool)}</p>
          </article>
          <article className={styles.fundCard}>
            <h2>Ваш баланс</h2>
            <p>{currentPlayer ? formatMoney(currentPlayer.balance) : "—"}</p>
          </article>
        </section>

        <section className={styles.section}>
          <h2>Игроки ({Object.keys(roomState.players).length})</h2>
          <div className={styles.playersGrid}>
            {Object.values(roomState.players).map((player) => (
              <article key={player.id} className={styles.playerCard}>
                <div className={styles.playerHead}>
                  <h3>{player.name}</h3>
                  <p className={styles.playerBalance}>{formatMoney(player.balance)}</p>
                </div>
                <div className={styles.actionGrid}>
                  <button type="button" onClick={() => openOperationDialog("add", player.id)}>
                    +$
                  </button>
                  <button type="button" onClick={() => openOperationDialog("remove", player.id)}>
                    -$
                  </button>
                  <button type="button" onClick={() => openOperationDialog("transfer", player.id)}>
                    →
                  </button>
                  <button type="button" onClick={() => openOperationDialog("toBank", player.id)}>
                    В банк
                  </button>
                  <button type="button" onClick={() => openOperationDialog("fromBank", player.id)}>
                    Из банка
                  </button>
                  <button type="button" onClick={() => openOperationDialog("toPool", player.id)}>
                    В общак
                  </button>
                  <button type="button" onClick={() => openOperationDialog("fromPool", player.id)}>
                    Из общака
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>История операций</h2>
          <ul className={styles.historyList}>
            {roomState.history.length === 0 && <li className={styles.emptyState}>Операций пока нет.</li>}
            {roomState.history.map((item) => (
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
        </section>

        {message && <p className={styles.messageText}>{message}</p>}
        {errorText && <p className={styles.errorText}>{errorText}</p>}
      </section>

      {dialog && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h2>{operationTitle(dialog.type)}</h2>
            <p className={styles.modalCaption}>Игрок: {roomState.players[dialog.playerId]?.name ?? "—"}</p>

            <label htmlFor="amount">Сумма</label>
            <input
              id="amount"
              className={styles.input}
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              inputMode="numeric"
              placeholder="100"
            />

            {dialog.type === "transfer" && (
              <>
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
              </>
            )}

            <div className={styles.inlineActions}>
              <button type="button" className={styles.ghostButton} onClick={closeOperationDialog}>
                Отмена
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleOperationSubmit}>
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
