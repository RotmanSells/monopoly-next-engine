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
const QUICK_AMOUNTS = [50, 100, 200, 500, 1000] as const;
const PLAYER_EMOJIS = ["🦊", "🐼", "🐯", "🐵", "🦁", "🐨", "🐸", "🐙", "🦄", "🐬"] as const;

type SessionPayload = {
  roomCode: string;
  playerId: string;
  playerName: string;
};

type RoomTab = "players" | "history" | "profile";

function parseAmount(value: string): number {
  return Number.parseInt(value.replace(/[\D]/g, ""), 10);
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

function operationIcon(type: RoomOperationType): string {
  switch (type) {
    case "add":
      return "➕";
    case "remove":
      return "➖";
    case "transfer":
      return "🔄";
    case "toBank":
      return "🏦";
    case "fromBank":
      return "💼";
    case "toPool":
      return "🎯";
    case "fromPool":
      return "🎁";
    default:
      return "✨";
  }
}

function tabLabel(tab: RoomTab): string {
  switch (tab) {
    case "players":
      return "Игроки";
    case "history":
      return "История";
    case "profile":
      return "Профиль";
    default:
      return "Игроки";
  }
}

function tabEmoji(tab: RoomTab): string {
  switch (tab) {
    case "players":
      return "👥";
    case "history":
      return "📜";
    case "profile":
      return "🧑";
    default:
      return "👥";
  }
}

function sanitizeRoomCode(rawValue: string): string {
  return rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function formatRoomCode(rawValue: string): string {
  const compact = sanitizeRoomCode(rawValue);
  if (compact.length <= 3) {
    return compact;
  }
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

function displayRoomCode(rawValue: string): string {
  const compact = sanitizeRoomCode(rawValue);
  const padded = `${compact}••••••`.slice(0, 6);
  const value = `${padded.slice(0, 3)}-${padded.slice(3)}`;
  return value;
}

function playerEmoji(player: RoomPlayer): string {
  const source = `${player.id}${player.name}`;
  const hash = Array.from(source).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PLAYER_EMOJIS[hash % PLAYER_EMOJIS.length];
}

function playerInitial(player: RoomPlayer): string {
  const trimmed = player.name.trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed[0]?.toUpperCase() ?? "?";
}

const TABS: RoomTab[] = ["players", "history", "profile"];

export function MonopolyRoomApp() {
  const [roomCodeInput, setRoomCodeInput] = useState(() => generateRoomCode());
  const [playerNameInput, setPlayerNameInput] = useState("");

  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [currentPlayerName, setCurrentPlayerName] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);

  const [activeTab, setActiveTab] = useState<RoomTab>("players");

  const [operationModalOpen, setOperationModalOpen] = useState(false);
  const [modalOperationType, setModalOperationType] = useState<RoomOperationType>("add");
  const [modalPlayerId, setModalPlayerId] = useState("");
  const [modalRecipientId, setModalRecipientId] = useState("");
  const [modalAmountInput, setModalAmountInput] = useState("0");

  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const currentPlayer = useMemo(
    () => (currentPlayerId ? getPlayerById(roomState, currentPlayerId) : null),
    [currentPlayerId, roomState],
  );

  const players = useMemo(() => Object.values(roomState?.players ?? {}), [roomState]);

  const sortedPlayers = useMemo(
    () => [...players].sort((left, right) => right.balance - left.balance),
    [players],
  );

  const historyItems = useMemo(() => roomState?.history ?? [], [roomState?.history]);
  const orderedHistoryItems = useMemo(() => [...historyItems].reverse(), [historyItems]);

  const activeModalPlayer = useMemo(
    () => (modalPlayerId ? roomState?.players[modalPlayerId] ?? null : null),
    [modalPlayerId, roomState],
  );

  const modalRecipients = useMemo(() => {
    if (!roomState || modalOperationType !== "transfer" || !modalPlayerId) {
      return [];
    }

    return Object.values(roomState.players).filter((player) => player.id !== modalPlayerId);
  }, [modalOperationType, modalPlayerId, roomState]);

  const modalAmountValue = useMemo(() => {
    const parsed = parseAmount(modalAmountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return parsed;
  }, [modalAmountInput]);

  const modalTitle = useMemo(() => operationTitle(modalOperationType), [modalOperationType]);

  const modalSubtitle = useMemo(() => {
    if (!activeModalPlayer) {
      return "Выберите профиль игрока";
    }

    if (modalOperationType === "transfer") {
      const recipient = modalRecipients.find((player) => player.id === modalRecipientId);
      if (recipient) {
        return `${activeModalPlayer.name} → ${recipient.name}`;
      }
      return `Отправитель: ${activeModalPlayer.name}`;
    }

    return `Профиль: ${activeModalPlayer.name}`;
  }, [activeModalPlayer, modalOperationType, modalRecipientId, modalRecipients]);

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

  useEffect(() => {
    if (!message && !errorText) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setMessage(null);
      setErrorText(null);
    }, 2200);

    return () => window.clearTimeout(timeout);
  }, [errorText, message]);

  useEffect(() => {
    if (!roomState) {
      return;
    }

    if (modalPlayerId && roomState.players[modalPlayerId]) {
      return;
    }

    if (currentPlayerId && roomState.players[currentPlayerId]) {
      setModalPlayerId(currentPlayerId);
      return;
    }

    const fallbackId = Object.keys(roomState.players)[0];
    if (fallbackId) {
      setModalPlayerId(fallbackId);
    }
  }, [currentPlayerId, modalPlayerId, roomState]);

  useEffect(() => {
    if (modalOperationType !== "transfer") {
      setModalRecipientId("");
      return;
    }

    if (!modalPlayerId || !roomState) {
      setModalRecipientId("");
      return;
    }

    if (modalRecipientId && roomState.players[modalRecipientId] && modalRecipientId !== modalPlayerId) {
      return;
    }

    const fallbackRecipient = Object.values(roomState.players).find((player) => player.id !== modalPlayerId);
    setModalRecipientId(fallbackRecipient?.id ?? "");
  }, [modalOperationType, modalPlayerId, modalRecipientId, roomState]);

  const handleJoinRoom = useCallback(() => {
    resetTransientMessages();

    try {
      const { roomCode, playerId, room } = joinRoom(playerNameInput, roomCodeInput);
      setActiveRoomCode(roomCode);
      setCurrentPlayerId(playerId);
      setCurrentPlayerName(playerNameInput.trim());
      setRoomState(room);
      setModalPlayerId(playerId);
      setActiveTab("players");
      persistSession({
        roomCode,
        playerId,
        playerName: playerNameInput.trim(),
      });
      setMessage(`Добро пожаловать в комнату ${roomCode}`);
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
    setRoomCodeInput(generateRoomCode());
    setPlayerNameInput("");
    setModalPlayerId("");
    setModalRecipientId("");
    setModalOperationType("add");
    setModalAmountInput("0");
    setOperationModalOpen(false);
    setMessage("Вы вышли из комнаты.");
  }, [activeRoomCode, currentPlayerId]);

  const handleCopyRoomCode = useCallback(() => {
    if (!activeRoomCode || !navigator.clipboard) {
      return;
    }

    navigator.clipboard
      .writeText(activeRoomCode)
      .then(() => {
        setMessage("Код комнаты скопирован");
      })
      .catch(() => {
        setErrorText("Не удалось скопировать код комнаты");
      });
  }, [activeRoomCode]);

  const openOperationModal = useCallback(
    (playerId: string, type: RoomOperationType) => {
      setModalPlayerId(playerId);
      setModalOperationType(type);
      setModalAmountInput("0");
      setOperationModalOpen(true);
      setErrorText(null);
    },
    [],
  );

  const closeOperationModal = useCallback(() => {
    setOperationModalOpen(false);
  }, []);

  const setQuickAmount = useCallback((amount: number) => {
    setModalAmountInput(String(amount));
  }, []);

  const keypadInput = useCallback((digit: string) => {
    setModalAmountInput((currentValue) => {
      const currentDigits = currentValue.replace(/\D/g, "");
      const nextDigits = currentDigits === "0" ? digit : `${currentDigits}${digit}`;
      return nextDigits.slice(0, 9);
    });
  }, []);

  const keypadClear = useCallback(() => {
    setModalAmountInput((currentValue) => {
      const nextDigits = currentValue.replace(/\D/g, "").slice(0, -1);
      return nextDigits.length > 0 ? nextDigits : "0";
    });
  }, []);

  const handleOperationSubmit = useCallback(() => {
    if (!activeRoomCode || !modalPlayerId) {
      return;
    }

    const amount = parseAmount(modalAmountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorText("Введите корректную положительную сумму");
      return;
    }

    if (modalOperationType === "transfer" && !modalRecipientId) {
      setErrorText("Выберите получателя для перевода");
      return;
    }

    try {
      executeRoomOperation(activeRoomCode, {
        type: modalOperationType,
        playerId: modalPlayerId,
        amount,
        recipientPlayerId: modalOperationType === "transfer" ? modalRecipientId : undefined,
      });

      setMessage(`${operationIcon(modalOperationType)} ${operationTitle(modalOperationType)} выполнено`);
      setErrorText(null);
      closeOperationModal();
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [
    activeRoomCode,
    closeOperationModal,
    modalAmountInput,
    modalOperationType,
    modalPlayerId,
    modalRecipientId,
  ]);

  const handleRoomCodeDigit = useCallback((digit: string) => {
    setRoomCodeInput((current) => {
      const compact = sanitizeRoomCode(current);
      if (compact.length >= 6) {
        return formatRoomCode(compact);
      }
      return formatRoomCode(`${compact}${digit}`);
    });
  }, []);

  const handleRoomCodeClear = useCallback(() => {
    setRoomCodeInput((current) => {
      const compact = sanitizeRoomCode(current);
      return formatRoomCode(compact.slice(0, -1));
    });
  }, []);

  const handleRoomCodeConfirm = useCallback(() => {
    setRoomCodeInput((current) => formatRoomCode(current));
  }, []);

  if (!activeRoomCode || !currentPlayerId || !roomState) {
    return (
      <main className={styles.page}>
        <div className={styles.bgAnimation} aria-hidden />

        <section className={styles.loginScreen}>
          <h1 className={styles.logo}>MONOPOLY</h1>
          <p className={styles.logoSubtitle}>Money Tracker</p>

          <div className={styles.roomCodeDisplay}>
            <div className={styles.roomCodeLabel}>Код комнаты</div>
            <div className={styles.roomCodeValue}>{displayRoomCode(roomCodeInput)}</div>
          </div>

          <div className={styles.customKeypad}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <button
                key={digit}
                type="button"
                className={styles.keypadButton}
                onClick={() => handleRoomCodeDigit(String(digit))}
              >
                {digit}
              </button>
            ))}
            <button type="button" className={`${styles.keypadButton} ${styles.keypadButtonClear}`} onClick={handleRoomCodeClear}>
              ✕
            </button>
            <button type="button" className={styles.keypadButton} onClick={() => handleRoomCodeDigit("0")}>
              0
            </button>
            <button
              type="button"
              className={`${styles.keypadButton} ${styles.keypadButtonAction}`}
              onClick={handleRoomCodeConfirm}
            >
              ✓
            </button>
          </div>

          <input
            className={styles.roomCodeInput}
            value={formatRoomCode(roomCodeInput)}
            onChange={(event) => setRoomCodeInput(formatRoomCode(event.target.value))}
            placeholder="Или введите код вручную"
            maxLength={7}
          />

          <input
            className={styles.nameInput}
            value={playerNameInput}
            onChange={(event) => setPlayerNameInput(event.target.value)}
            placeholder="Ваше имя"
            maxLength={18}
          />

          <div className={styles.loginActionsRow}>
            <button
              type="button"
              className={styles.secondaryGhostButton}
              onClick={() => setRoomCodeInput(generateRoomCode())}
            >
              🎲 Новый код
            </button>
            <button type="button" className={styles.joinButton} onClick={handleJoinRoom}>
              Войти в игру
            </button>
          </div>

          {(message || errorText) && (
            <p className={errorText ? styles.inlineError : styles.inlineMessage}>{errorText ?? message}</p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.bgAnimation} aria-hidden />

      {(message || errorText) && (
        <div className={`${styles.toast} ${message || errorText ? styles.toastShow : ""} ${errorText ? styles.toastError : ""}`}>
          {errorText ?? message}
        </div>
      )}

      <section className={styles.appContainer}>
        <header className={styles.gameHeader}>
          <div className={styles.roomInfo}>
            <div className={styles.roomBadge}>{activeRoomCode}</div>
            <div className={styles.playerCount}>👥 {players.length} игрока(ов)</div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.codeButton} onClick={handleCopyRoomCode}>
              📋 Код
            </button>
            <button type="button" className={styles.leaveButton} onClick={handleLeaveRoom}>
              Выйти
            </button>
          </div>
        </header>

        <section className={styles.fundsOverview}>
          <article className={`${styles.fundCard} ${styles.fundCardBank}`}>
            <div className={styles.fundIcon}>🏦</div>
            <div className={styles.fundLabel}>Банк</div>
            <div className={styles.fundAmount}>{formatMoney(roomState.bank)}</div>
          </article>
          <article className={`${styles.fundCard} ${styles.fundCardPool}`}>
            <div className={styles.fundIcon}>🎯</div>
            <div className={styles.fundLabel}>Общак</div>
            <div className={styles.fundAmount}>{formatMoney(roomState.pool)}</div>
          </article>
        </section>

        <section className={styles.tabContent}>
          {activeTab === "players" && (
            <div className={styles.playersSection}>
              <div className={styles.sectionTitle}>Профили игроков</div>
              <div className={styles.playerList}>
                {sortedPlayers.map((player) => {
                  const isCurrent = player.id === currentPlayerId;
                  const balanceClass = player.balance < 0 ? styles.balanceAmountNegative : "";

                  return (
                    <article
                      key={player.id}
                      className={`${styles.playerCard} ${isCurrent ? styles.playerCardCurrentUser : ""}`}
                    >
                      <div className={styles.playerHeader}>
                        <div className={styles.playerInfo}>
                          <div className={styles.playerAvatar}>
                            <span>{playerInitial(player)}</span>
                            <small>{playerEmoji(player)}</small>
                          </div>
                          <div>
                            <div className={styles.playerName}>
                              {player.name}
                              {isCurrent && <span className={styles.playerBadge}>Вы</span>}
                            </div>
                          </div>
                        </div>
                        <div className={styles.playerBalance}>
                          <div className={styles.balanceLabel}>Баланс</div>
                          <div className={`${styles.balanceAmount} ${balanceClass}`}>{formatMoney(player.balance)}</div>
                        </div>
                      </div>

                      <div className={styles.playerActions}>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionButtonAdd}`}
                          onClick={() => openOperationModal(player.id, "add")}
                        >
                          ➕
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionButtonRemove}`}
                          onClick={() => openOperationModal(player.id, "remove")}
                        >
                          ➖
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionButtonTransfer}`}
                          onClick={() => openOperationModal(player.id, "transfer")}
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionButton} ${styles.actionButtonBank}`}
                          onClick={() => openOperationModal(player.id, "toBank")}
                        >
                          🏦
                        </button>
                      </div>

                      <div className={styles.extraActions}>
                        <button type="button" className={styles.extraButton} onClick={() => openOperationModal(player.id, "toBank")}>
                          В банк
                        </button>
                        <button type="button" className={styles.extraButton} onClick={() => openOperationModal(player.id, "toPool")}>
                          В общак
                        </button>
                        <button type="button" className={styles.extraButton} onClick={() => openOperationModal(player.id, "fromBank")}>
                          Из банка
                        </button>
                        <button type="button" className={styles.extraButton} onClick={() => openOperationModal(player.id, "fromPool")}>
                          Из общака
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className={styles.historySection}>
              <div className={styles.sectionTitle}>История операций</div>
              <div className={styles.historyList}>
                {historyItems.length === 0 && <div className={styles.emptyState}>Операций пока нет.</div>}

                {orderedHistoryItems.map((item) => {
                  const isPositive = operationSign(item.type) === "+";
                  return (
                    <article key={item.id} className={styles.historyItem}>
                      <div className={styles.historyInfo}>
                        <div className={styles.historyType}>
                          {operationIcon(item.type)} {operationTitle(item.type)}
                        </div>
                        <div className={styles.historyDescription}>{item.description}</div>
                        <div className={styles.historyTime}>
                          {new Date(item.timestamp).toLocaleTimeString("ru-RU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      <div className={`${styles.historyAmount} ${isPositive ? styles.historyAmountPositive : styles.historyAmountNegative}`}>
                        {operationSign(item.type)}{formatMoney(item.amount)}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "profile" && currentPlayer && (
            <div className={styles.profileSection}>
              <div className={styles.sectionTitle}>Мой профиль</div>
              <article className={styles.profileCard}>
                <div className={styles.profileAvatar}>
                  <span>{playerInitial(currentPlayer)}</span>
                  <small>{playerEmoji(currentPlayer)}</small>
                </div>
                <div className={styles.profileName}>{currentPlayerName}</div>
                <div className={styles.profileMeta}>Ваш персональный кабинет в комнате {activeRoomCode}</div>
                <div className={styles.profileStats}>
                  <div className={styles.profileStatItem}>
                    <span>Баланс</span>
                    <strong>{formatMoney(currentPlayer.balance)}</strong>
                  </div>
                  <div className={styles.profileStatItem}>
                    <span>Операций</span>
                    <strong>{historyItems.filter((item) => item.playerId === currentPlayer.id).length}</strong>
                  </div>
                  <div className={styles.profileStatItem}>
                    <span>В игре с</span>
                    <strong>
                      {new Date(currentPlayer.joinedAt).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </strong>
                  </div>
                </div>
                <div className={styles.profileQuickActions}>
                  <button type="button" className={styles.profileQuickButton} onClick={() => openOperationModal(currentPlayer.id, "add")}>➕ Пополнить</button>
                  <button type="button" className={styles.profileQuickButton} onClick={() => openOperationModal(currentPlayer.id, "transfer")}>🔄 Перевести</button>
                  <button type="button" className={styles.profileQuickButton} onClick={() => openOperationModal(currentPlayer.id, "toBank")}>🏦 В банк</button>
                </div>
              </article>
            </div>
          )}
        </section>

        <nav className={styles.bottomNav}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${styles.navButton} ${activeTab === tab ? styles.navButtonActive : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              <span className={styles.navIcon}>{tabEmoji(tab)}</span>
              <span>{tabLabel(tab)}</span>
            </button>
          ))}
        </nav>
      </section>

      {operationModalOpen && (
        <div className={styles.modalOverlay} onClick={closeOperationModal} role="presentation">
          <div className={styles.modalContent} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <header className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>{modalTitle}</h2>
                <p className={styles.modalSubtitle}>{modalSubtitle}</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={closeOperationModal}>
                ✕
              </button>
            </header>

            <div className={styles.amountDisplay}>
              <div className={styles.amountLabel}>Сумма операции</div>
              <div className={styles.amountValue}>{formatMoney(modalAmountValue)}</div>
            </div>

            <div className={styles.quickAmounts}>
              {QUICK_AMOUNTS.map((amount) => (
                <button key={amount} type="button" className={styles.quickAmountButton} onClick={() => setQuickAmount(amount)}>
                  {formatMoney(amount)}
                </button>
              ))}
            </div>

            <div className={styles.modalKeypad}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button key={digit} type="button" className={styles.keypadButton} onClick={() => keypadInput(String(digit))}>
                  {digit}
                </button>
              ))}
              <button type="button" className={`${styles.keypadButton} ${styles.keypadButtonZero}`} onClick={() => keypadInput("0")}>0</button>
              <button type="button" className={`${styles.keypadButton} ${styles.keypadButtonClear}`} onClick={keypadClear}>✕</button>
            </div>

            {modalOperationType === "transfer" && (
              <section className={styles.recipientSection}>
                <h3 className={styles.recipientTitle}>Получатель</h3>
                <div className={styles.recipientList}>
                  {modalRecipients.map((recipient) => (
                    <button
                      key={recipient.id}
                      type="button"
                      className={`${styles.recipientItem} ${modalRecipientId === recipient.id ? styles.recipientItemSelected : ""}`}
                      onClick={() => setModalRecipientId(recipient.id)}
                    >
                      <span className={styles.recipientInfo}>
                        <span className={styles.recipientAvatar}>{playerInitial(recipient)}</span>
                        <span className={styles.recipientName}>{recipient.name}</span>
                      </span>
                      <span className={styles.recipientBalance}>{formatMoney(recipient.balance)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <footer className={styles.modalActions}>
              <button type="button" className={`${styles.modalButton} ${styles.modalButtonCancel}`} onClick={closeOperationModal}>
                Отмена
              </button>
              <button type="button" className={`${styles.modalButton} ${styles.modalButtonConfirm}`} onClick={handleOperationSubmit}>
                {operationIcon(modalOperationType)} {operationTitle(modalOperationType)}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
