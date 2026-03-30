"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomDomainError } from "@/src/domain/room/errors";
import { RoomOperationType, RoomPlayer, RoomState } from "@/src/domain/room/types";
import {
  executeRoomOperation,
  generateRoomCode,
  getRoom,
  joinRoom,
  leaveRoom,
  resetRoom,
  subscribeToRoom,
} from "@/src/application/room/room-engine";
import styles from "@/src/ui/components/monopoly-room-app.module.css";

const SESSION_STORAGE_KEY = "monopoly-room-session";
const PLAYER_NAME_STORAGE_KEY = "monopoly-player-name";
const QUICK_AMOUNTS = [50, 100, 200, 500, 1000] as const;
const PLAYER_EMOJIS = ["🦊", "🐼", "🐯", "🐵", "🦁", "🐨", "🐸", "🐙", "🦄", "🐬"] as const;

type SessionPayload = {
  roomCode: string;
  playerId: string;
  playerName: string;
};

type RoomTab = "players" | "history" | "profile" | "calculator";
type CalculatorOperator = "add" | "subtract" | "multiply" | "divide";
const ROOM_CODE_REGEX = /^\d{4}$/;
const CALCULATOR_OPERATOR_SYMBOL: Record<CalculatorOperator, string> = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
};

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
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }

  if (payload === null) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function loadSession(): SessionPayload | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return null;
  }

  const rawPayload = localStorage.getItem(SESSION_STORAGE_KEY);
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
      const candidate = unknownPayload as SessionPayload;
      if (
        ROOM_CODE_REGEX.test(candidate.roomCode) &&
        typeof candidate.playerId === "string" &&
        candidate.playerId.length > 0 &&
        typeof candidate.playerName === "string" &&
        candidate.playerName.length > 0
      ) {
        return candidate;
      }
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function persistPreferredPlayerName(name: string): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }

  const normalized = name.replace(/\s+/g, " ").trim().slice(0, 18);
  if (!normalized) {
    return;
  }

  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, normalized);
}

function loadPreferredPlayerName(): string {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return "";
  }

  const rawName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
  if (!rawName) {
    return "";
  }

  return rawName.replace(/\s+/g, " ").trim().slice(0, 18);
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
      return "🏦 В банк";
    case "fromBank":
      return "💼 Из банка";
    case "toPool":
      return "🎯 В общаг";
    case "fromPool":
      return "🎁 Из общага";
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

function playerLabelById(room: RoomState | null, playerId: string): string {
  const playerName = room?.players[playerId]?.name;
  if (playerName) {
    return playerName;
  }

  return `Игрок ${playerId.slice(-4)}`;
}

function historyActorDescription(room: RoomState | null, item: { playerId: string; recipientPlayerId?: string }): string {
  const actor = playerLabelById(room, item.playerId);
  if (item.recipientPlayerId) {
    const recipient = playerLabelById(room, item.recipientPlayerId);
    return `${actor} → ${recipient}`;
  }
  return actor;
}

function tabLabel(tab: RoomTab): string {
  switch (tab) {
    case "players":
      return "Игроки";
    case "history":
      return "История";
    case "calculator":
      return "Кальк";
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
    case "calculator":
      return "🧮";
    case "profile":
      return "🧑";
    default:
      return "👥";
  }
}

function sanitizeRoomCode(rawValue: string): string {
  return rawValue.replace(/\D/g, "").slice(0, 4);
}

function formatRoomCode(rawValue: string): string {
  return sanitizeRoomCode(rawValue);
}

function displayRoomCode(rawValue: string): string {
  const compact = sanitizeRoomCode(rawValue);
  return `${compact}••••`.slice(0, 4);
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

function formatCalculatorOutput(value: number): string {
  if (!Number.isFinite(value)) {
    return "Ошибка";
  }

  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  if (Math.abs(rounded) >= 1_000_000_000_000) {
    return rounded.toExponential(3);
  }

  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return String(rounded).replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}

function applyCalculatorOperator(operator: CalculatorOperator, left: number, right: number): number | null {
  switch (operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      return right === 0 ? null : left / right;
    default:
      return null;
  }
}

const TABS: RoomTab[] = ["players", "history", "calculator", "profile"];

export function MonopolyRoomApp() {
  const [roomCodeInput, setRoomCodeInput] = useState("0000");
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
  const hasSeenSyncedRoomRef = useRef(false);
  const missingCurrentPlayerSinceRef = useRef<number | null>(null);
  const [calcDisplay, setCalcDisplay] = useState("0");
  const [calcStoredValue, setCalcStoredValue] = useState<number | null>(null);
  const [calcPendingOperator, setCalcPendingOperator] = useState<CalculatorOperator | null>(null);
  const [calcWaitingNextValue, setCalcWaitingNextValue] = useState(false);

  const currentPlayer = useMemo(
    () => (currentPlayerId ? getPlayerById(roomState, currentPlayerId) : null),
    [currentPlayerId, roomState],
  );

  const players = useMemo(() => Object.values(roomState?.players ?? {}), [roomState]);

  const sortedPlayers = useMemo(
    () => [...players].sort((left, right) => right.balance - left.balance),
    [players],
  );

  const orderedPlayers = useMemo(() => {
    if (!currentPlayerId) {
      return sortedPlayers;
    }

    const current = sortedPlayers.find((player) => player.id === currentPlayerId);
    const others = sortedPlayers.filter((player) => player.id !== currentPlayerId);
    return current ? [current, ...others] : others;
  }, [currentPlayerId, sortedPlayers]);

  const historyItems = useMemo(() => roomState?.history ?? [], [roomState?.history]);
  const orderedHistoryItems = useMemo(() => [...historyItems].reverse(), [historyItems]);

  const effectiveModalPlayerId = useMemo(() => {
    if (modalPlayerId && roomState?.players[modalPlayerId]) {
      return modalPlayerId;
    }

    if (currentPlayerId && roomState?.players[currentPlayerId]) {
      return currentPlayerId;
    }

    return roomState ? (Object.keys(roomState.players)[0] ?? "") : "";
  }, [currentPlayerId, modalPlayerId, roomState]);

  const activeModalPlayer = useMemo(
    () => (effectiveModalPlayerId ? roomState?.players[effectiveModalPlayerId] ?? null : null),
    [effectiveModalPlayerId, roomState],
  );

  const modalRecipients = useMemo(() => {
    if (!roomState || modalOperationType !== "transfer" || !effectiveModalPlayerId) {
      return [];
    }

    return Object.values(roomState.players).filter((player) => player.id !== effectiveModalPlayerId);
  }, [effectiveModalPlayerId, modalOperationType, roomState]);

  const effectiveModalRecipientId = useMemo(() => {
    if (modalOperationType !== "transfer") {
      return "";
    }

    if (modalRecipientId && modalRecipients.some((recipient) => recipient.id === modalRecipientId)) {
      return modalRecipientId;
    }

    return modalRecipients[0]?.id ?? "";
  }, [modalOperationType, modalRecipientId, modalRecipients]);

  const modalAmountValue = useMemo(() => {
    const parsed = parseAmount(modalAmountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return parsed;
  }, [modalAmountInput]);

  const modalTitle = useMemo(() => operationTitle(modalOperationType), [modalOperationType]);
  const calculatorHint = useMemo(() => {
    if (calcStoredValue === null || calcPendingOperator === null) {
      return "Милый калькулятор для быстрых расчетов 🐰";
    }

    return `${formatCalculatorOutput(calcStoredValue)} ${CALCULATOR_OPERATOR_SYMBOL[calcPendingOperator]} …`;
  }, [calcPendingOperator, calcStoredValue]);

  const modalSubtitle = useMemo(() => {
    if (!activeModalPlayer) {
      return "Выберите профиль игрока";
    }

    if (modalOperationType === "transfer") {
      const recipient = modalRecipients.find((player) => player.id === effectiveModalRecipientId);
      if (recipient) {
        return `${activeModalPlayer.name} → ${recipient.name}`;
      }
      return `Отправитель: ${activeModalPlayer.name}`;
    }

    return `Профиль: ${activeModalPlayer.name}`;
  }, [activeModalPlayer, effectiveModalRecipientId, modalOperationType, modalRecipients]);

  const resetTransientMessages = useCallback(() => {
    setMessage(null);
    setErrorText(null);
  }, []);

  useEffect(() => {
    if (!activeRoomCode || !currentPlayerId) {
      return;
    }

    hasSeenSyncedRoomRef.current = false;
    missingCurrentPlayerSinceRef.current = null;

    const applyIncomingRoom = (nextRoom: RoomState | null): void => {
      if (!nextRoom) {
        if (!hasSeenSyncedRoomRef.current) {
          return;
        }
        setMessage("Комната очищена. Создайте новую или подключитесь снова.");
        persistSession(null);
        setActiveRoomCode(null);
        setCurrentPlayerId(null);
        setCurrentPlayerName(null);
        setRoomState(null);
        setRoomCodeInput(generateRoomCode());
        return;
      }

      hasSeenSyncedRoomRef.current = true;
      setRoomState(nextRoom);

      if (nextRoom.players[currentPlayerId]) {
        missingCurrentPlayerSinceRef.current = null;
        return;
      }

      const now = Date.now();
      const missingSince = missingCurrentPlayerSinceRef.current;

      if (missingSince === null) {
        missingCurrentPlayerSinceRef.current = now;
        return;
      }

      if (now - missingSince < 4_000) {
        return;
      }

      setErrorText("Ваш профиль удалён из комнаты. Перезайдите.");
      persistSession(null);
      setActiveRoomCode(null);
      setCurrentPlayerId(null);
      setCurrentPlayerName(null);
      missingCurrentPlayerSinceRef.current = null;
    };

    const unsubscribe = subscribeToRoom(activeRoomCode, (nextRoom) => {
      applyIncomingRoom(nextRoom);
    });

    const refreshFromSnapshot = (): void => {
      try {
        const snapshot = getRoom(activeRoomCode);
        if (!snapshot) {
          return;
        }
        applyIncomingRoom(snapshot);
      } catch {
        // Ignore transient polling errors and rely on realtime stream.
      }
    };

    refreshFromSnapshot();
    const pollTimer = window.setInterval(refreshFromSnapshot, 350);
    window.addEventListener("focus", refreshFromSnapshot);
    document.addEventListener("visibilitychange", refreshFromSnapshot);

    return () => {
      window.clearInterval(pollTimer);
      window.removeEventListener("focus", refreshFromSnapshot);
      document.removeEventListener("visibilitychange", refreshFromSnapshot);
      unsubscribe();
    };
  }, [activeRoomCode, currentPlayerId]);

  useEffect(() => {
    const savedSession = loadSession();
    const preferredPlayerName = loadPreferredPlayerName();

    if (preferredPlayerName) {
      startTransition(() => {
        setPlayerNameInput(preferredPlayerName);
      });
    }

    if (!savedSession) {
      return;
    }

    startTransition(() => {
      setActiveRoomCode(savedSession.roomCode);
      setCurrentPlayerId(savedSession.playerId);
      setCurrentPlayerName(savedSession.playerName);
      setPlayerNameInput(savedSession.playerName);
    });
  }, []);

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

  const handleJoinRoom = useCallback(() => {
    resetTransientMessages();

    try {
      const { roomCode, playerId, room } = joinRoom(playerNameInput, roomCodeInput);
      const normalizedName = playerNameInput.trim();
      setActiveRoomCode(roomCode);
      setCurrentPlayerId(playerId);
      setCurrentPlayerName(normalizedName);
      setRoomState(room);
      setModalPlayerId(playerId);
      setActiveTab("players");
      persistPreferredPlayerName(normalizedName);
      persistSession({
        roomCode,
        playerId,
        playerName: normalizedName,
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

  const handleResetRoom = useCallback(() => {
    if (!activeRoomCode) {
      return;
    }

    const isConfirmed = window.confirm(
      `Сбросить комнату ${activeRoomCode}? Это удалит весь прогресс и игроков у всех устройств.`,
    );

    if (!isConfirmed) {
      return;
    }

    try {
      resetRoom(activeRoomCode);
      persistSession(null);
      setActiveRoomCode(null);
      setCurrentPlayerId(null);
      setCurrentPlayerName(null);
      setRoomState(null);
      setRoomCodeInput(generateRoomCode());
      setModalPlayerId("");
      setModalRecipientId("");
      setModalOperationType("add");
      setModalAmountInput("0");
      setOperationModalOpen(false);
      setMessage(`Комната ${activeRoomCode} очищена`);
      setErrorText(null);
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [activeRoomCode]);

  const openOperationModal = useCallback(
    (type: RoomOperationType, recipientPlayerId?: string) => {
      if (!currentPlayerId) {
        return;
      }
      setModalPlayerId(currentPlayerId);
      setModalOperationType(type);
      if (type === "transfer") {
        setModalRecipientId(recipientPlayerId ?? "");
      } else {
        setModalRecipientId("");
      }
      setModalAmountInput("0");
      setOperationModalOpen(true);
      setErrorText(null);
    },
    [currentPlayerId],
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
    if (!activeRoomCode || !currentPlayerId) {
      return;
    }

    const amount = parseAmount(modalAmountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorText("Введите корректную положительную сумму");
      return;
    }

    if (modalOperationType === "transfer" && !effectiveModalRecipientId) {
      setErrorText("Выберите получателя для перевода");
      return;
    }

    try {
      executeRoomOperation(activeRoomCode, {
        type: modalOperationType,
        playerId: currentPlayerId,
        amount,
        recipientPlayerId: modalOperationType === "transfer" ? effectiveModalRecipientId : undefined,
      }, currentPlayerId);

      setMessage(`${operationIcon(modalOperationType)} ${operationTitle(modalOperationType)} выполнено`);
      setErrorText(null);
      closeOperationModal();
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [
    activeRoomCode,
    closeOperationModal,
    effectiveModalRecipientId,
    currentPlayerId,
    modalAmountInput,
    modalOperationType,
  ]);

  const handleRoomCodeDigit = useCallback((digit: string) => {
    setRoomCodeInput((current) => {
      const compact = sanitizeRoomCode(current);
      if (compact.length >= 4) {
        return compact;
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

  const handleTakeAllFromPool = useCallback(() => {
    if (!activeRoomCode || !currentPlayerId || !roomState) {
      return;
    }

    if (roomState.pool <= 0) {
      setMessage("В общаке нет денег");
      return;
    }

    try {
      executeRoomOperation(
        activeRoomCode,
        {
          type: "fromPool",
          playerId: currentPlayerId,
          amount: roomState.pool,
        },
        currentPlayerId,
      );
      setMessage(`Из общака начислено ${formatMoney(roomState.pool)}`);
      setErrorText(null);
    } catch (error) {
      setErrorText(mapDomainError(error));
    }
  }, [activeRoomCode, currentPlayerId, roomState]);

  const resetCalculator = useCallback(() => {
    setCalcDisplay("0");
    setCalcStoredValue(null);
    setCalcPendingOperator(null);
    setCalcWaitingNextValue(false);
  }, []);

  const handleCalculatorDigit = useCallback(
    (digit: string) => {
      if (calcDisplay === "Ошибка" || calcWaitingNextValue) {
        setCalcDisplay(digit);
        setCalcWaitingNextValue(false);
        return;
      }

      if (calcDisplay === "0") {
        setCalcDisplay(digit);
        return;
      }

      if (calcDisplay.length >= 14) {
        return;
      }

      setCalcDisplay(`${calcDisplay}${digit}`);
    },
    [calcDisplay, calcWaitingNextValue],
  );

  const handleCalculatorDot = useCallback(() => {
    if (calcDisplay === "Ошибка" || calcWaitingNextValue) {
      setCalcDisplay("0.");
      setCalcWaitingNextValue(false);
      return;
    }

    if (calcDisplay.includes(".")) {
      return;
    }

    setCalcDisplay(`${calcDisplay}.`);
  }, [calcDisplay, calcWaitingNextValue]);

  const handleCalculatorBackspace = useCallback(() => {
    if (calcDisplay === "Ошибка" || calcWaitingNextValue) {
      setCalcDisplay("0");
      setCalcWaitingNextValue(false);
      return;
    }

    if (calcDisplay.length <= 1) {
      setCalcDisplay("0");
      return;
    }

    if (calcDisplay.length === 2 && calcDisplay.startsWith("-")) {
      setCalcDisplay("0");
      return;
    }

    setCalcDisplay(calcDisplay.slice(0, -1));
  }, [calcDisplay, calcWaitingNextValue]);

  const handleCalculatorToggleSign = useCallback(() => {
    if (calcDisplay === "Ошибка" || calcDisplay === "0") {
      return;
    }

    if (calcDisplay.startsWith("-")) {
      setCalcDisplay(calcDisplay.slice(1));
      return;
    }

    setCalcDisplay(`-${calcDisplay}`);
  }, [calcDisplay]);

  const handleCalculatorPercent = useCallback(() => {
    if (calcDisplay === "Ошибка") {
      return;
    }

    const value = Number(calcDisplay);
    if (!Number.isFinite(value)) {
      return;
    }

    setCalcDisplay(formatCalculatorOutput(value / 100));
    setCalcWaitingNextValue(false);
  }, [calcDisplay]);

  const handleCalculatorOperator = useCallback(
    (nextOperator: CalculatorOperator) => {
      if (calcDisplay === "Ошибка") {
        return;
      }

      const inputValue = Number(calcDisplay);
      if (!Number.isFinite(inputValue)) {
        return;
      }

      if (calcStoredValue === null) {
        setCalcStoredValue(inputValue);
        setCalcPendingOperator(nextOperator);
        setCalcWaitingNextValue(true);
        return;
      }

      if (!calcPendingOperator || calcWaitingNextValue) {
        setCalcPendingOperator(nextOperator);
        setCalcWaitingNextValue(true);
        return;
      }

      const computed = applyCalculatorOperator(calcPendingOperator, calcStoredValue, inputValue);
      if (computed === null) {
        setCalcDisplay("Ошибка");
        setCalcStoredValue(null);
        setCalcPendingOperator(null);
        setCalcWaitingNextValue(true);
        return;
      }

      setCalcDisplay(formatCalculatorOutput(computed));
      setCalcStoredValue(computed);
      setCalcPendingOperator(nextOperator);
      setCalcWaitingNextValue(true);
    },
    [calcDisplay, calcPendingOperator, calcStoredValue, calcWaitingNextValue],
  );

  const handleCalculatorEquals = useCallback(() => {
    if (calcDisplay === "Ошибка") {
      return;
    }

    if (calcStoredValue === null || calcPendingOperator === null || calcWaitingNextValue) {
      return;
    }

    const inputValue = Number(calcDisplay);
    if (!Number.isFinite(inputValue)) {
      return;
    }

    const computed = applyCalculatorOperator(calcPendingOperator, calcStoredValue, inputValue);
    if (computed === null) {
      setCalcDisplay("Ошибка");
      setCalcStoredValue(null);
      setCalcPendingOperator(null);
      setCalcWaitingNextValue(true);
      return;
    }

    setCalcDisplay(formatCalculatorOutput(computed));
    setCalcStoredValue(null);
    setCalcPendingOperator(null);
    setCalcWaitingNextValue(true);
  }, [calcDisplay, calcPendingOperator, calcStoredValue, calcWaitingNextValue]);

  if (!activeRoomCode || !currentPlayerId || !roomState) {
    return (
      <main className={styles.page}>
        <div className={styles.bgAnimation} aria-hidden />

        <section className={styles.loginScreen}>
          <h1 className={styles.logo}>MONOPOLY</h1>
          <p className={styles.logoSubtitle}>Money Tracker 🎲💸</p>

          <div className={styles.roomCodeDisplay}>
            <div className={styles.roomCodeLabel}>Код комнаты 🔢</div>
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
            maxLength={4}
          />

          <input
            className={styles.nameInput}
            value={playerNameInput}
            onChange={(event) => {
              const nextName = event.target.value.slice(0, 18);
              setPlayerNameInput(nextName);
              persistPreferredPlayerName(nextName);
            }}
            placeholder="Ваше имя 🙂"
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
              Войти в игру 🚀
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
            <button type="button" className={styles.resetButton} onClick={handleResetRoom} title="Сбросить комнату">
              🔄
            </button>
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
              <div className={styles.sectionTitle}>Профили игроков 👥</div>
              <div className={styles.playerList}>
                {orderedPlayers.map((player) => {
                  const isCurrent = player.id === currentPlayerId;
                  const balanceClass = player.balance < 0 ? styles.balanceAmountNegative : "";

                  return (
                    <article
                      key={player.id}
                      className={`${styles.playerCard} ${isCurrent ? styles.playerCardCurrentUser : styles.playerCardOther}`}
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
                          <div className={styles.balanceLabel}>Баланс 💰</div>
                          <div className={`${styles.balanceAmount} ${balanceClass}`}>{formatMoney(player.balance)}</div>
                        </div>
                      </div>

                      {isCurrent ? (
                        <>
                          <div className={styles.extraActions}>
                            <button type="button" className={styles.extraButton} onClick={() => openOperationModal("toBank")}>
                              🏦 В банк
                            </button>
                            <button type="button" className={styles.extraButton} onClick={() => openOperationModal("toPool")}>
                              🎯 В общаг
                            </button>
                            <button type="button" className={styles.extraButton} onClick={() => openOperationModal("fromBank")}>
                              💼 Из банка
                            </button>
                            <button type="button" className={styles.extraButton} onClick={handleTakeAllFromPool}>
                              🎁 Из общага
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className={styles.transferQuickRow}>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionButtonTransfer} ${styles.transferQuickButton}`}
                            onClick={() => openOperationModal("transfer", player.id)}
                          >
                            🔄 Перевести
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className={styles.historySection}>
              <div className={styles.sectionTitle}>История операций 📜</div>
              <div className={styles.historyList}>
                {historyItems.length === 0 && <div className={styles.emptyState}>Операций пока нет 🙂</div>}

                {orderedHistoryItems.map((item) => {
                  const isPositive = operationSign(item.type) === "+";
                  return (
                    <article key={item.id} className={styles.historyItem}>
                      <div className={styles.historyInfo}>
                        <div className={styles.historyType}>
                          {operationIcon(item.type)} {operationTitle(item.type)}
                        </div>
                        <div className={styles.historyDescription}>{historyActorDescription(roomState, item)}</div>
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

          {activeTab === "calculator" && (
            <div className={styles.calculatorSection}>
              <div className={styles.sectionTitle}>Калькулятор 🧮</div>
              <article className={styles.calculatorCard}>
                <div className={styles.calculatorHead}>
                  <div className={styles.calculatorMascot}>🐰✨</div>
                  <div className={styles.calculatorHint}>{calculatorHint}</div>
                </div>

                <div className={styles.calculatorScreen}>
                  <div className={styles.calculatorScreenLabel}>Сумма</div>
                  <div className={styles.calculatorDisplay}>{calcDisplay}</div>
                </div>

                <div className={styles.calculatorGrid}>
                  <button type="button" className={`${styles.calcButton} ${styles.calcButtonFunction}`} onClick={resetCalculator}>
                    AC
                  </button>
                  <button type="button" className={`${styles.calcButton} ${styles.calcButtonFunction}`} onClick={handleCalculatorBackspace}>
                    ⌫
                  </button>
                  <button type="button" className={`${styles.calcButton} ${styles.calcButtonFunction}`} onClick={handleCalculatorPercent}>
                    %
                  </button>
                  <button
                    type="button"
                    className={`${styles.calcButton} ${styles.calcButtonOperator}`}
                    onClick={() => handleCalculatorOperator("divide")}
                  >
                    ÷
                  </button>

                  {[7, 8, 9].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      className={`${styles.calcButton} ${styles.calcButtonNumber}`}
                      onClick={() => handleCalculatorDigit(String(digit))}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`${styles.calcButton} ${styles.calcButtonOperator}`}
                    onClick={() => handleCalculatorOperator("multiply")}
                  >
                    ×
                  </button>

                  {[4, 5, 6].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      className={`${styles.calcButton} ${styles.calcButtonNumber}`}
                      onClick={() => handleCalculatorDigit(String(digit))}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`${styles.calcButton} ${styles.calcButtonOperator}`}
                    onClick={() => handleCalculatorOperator("subtract")}
                  >
                    −
                  </button>

                  {[1, 2, 3].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      className={`${styles.calcButton} ${styles.calcButtonNumber}`}
                      onClick={() => handleCalculatorDigit(String(digit))}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`${styles.calcButton} ${styles.calcButtonOperator}`}
                    onClick={() => handleCalculatorOperator("add")}
                  >
                    +
                  </button>

                  <button type="button" className={`${styles.calcButton} ${styles.calcButtonFunction}`} onClick={handleCalculatorToggleSign}>
                    ±
                  </button>
                  <button
                    type="button"
                    className={`${styles.calcButton} ${styles.calcButtonNumber}`}
                    onClick={() => handleCalculatorDigit("0")}
                  >
                    0
                  </button>
                  <button type="button" className={`${styles.calcButton} ${styles.calcButtonNumber}`} onClick={handleCalculatorDot}>
                    .
                  </button>
                  <button type="button" className={`${styles.calcButton} ${styles.calcButtonEqual}`} onClick={handleCalculatorEquals}>
                    =
                  </button>
                </div>
              </article>
            </div>
          )}

          {activeTab === "profile" && currentPlayer && (
            <div className={styles.profileSection}>
              <div className={styles.sectionTitle}>Мой профиль 🧑</div>
              <article className={styles.profileCard}>
                <div className={styles.profileAvatar}>
                  <span>{playerInitial(currentPlayer)}</span>
                  <small>{playerEmoji(currentPlayer)}</small>
                </div>
                <div className={styles.profileName}>{currentPlayerName}</div>
                <div className={styles.profileMeta}>Ваш персональный кабинет в комнате {activeRoomCode} 🏠</div>
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
                  <button type="button" className={styles.profileQuickButton} onClick={() => openOperationModal("toBank")}>🏦 В банк</button>
                  <button type="button" className={styles.profileQuickButton} onClick={() => openOperationModal("fromBank")}>💼 Из банка</button>
                  <button type="button" className={styles.profileQuickButton} onClick={() => openOperationModal("toPool")}>🎯 В общаг</button>
                  <button type="button" className={styles.profileQuickButton} onClick={handleTakeAllFromPool}>🎁 Из общага</button>
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

            <div className={styles.modalKeypad}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button key={digit} type="button" className={styles.keypadButton} onClick={() => keypadInput(String(digit))}>
                  {digit}
                </button>
              ))}
              <button type="button" className={`${styles.keypadButton} ${styles.keypadButtonZero}`} onClick={() => keypadInput("0")}>0</button>
              <button type="button" className={`${styles.keypadButton} ${styles.keypadButtonClear}`} onClick={keypadClear}>✕</button>
            </div>

            <div className={styles.quickAmounts}>
              {QUICK_AMOUNTS.map((amount) => (
                <button key={amount} type="button" className={styles.quickAmountButton} onClick={() => setQuickAmount(amount)}>
                  {formatMoney(amount)}
                </button>
              ))}
            </div>

            <div className={styles.amountDisplay}>
              <div className={styles.amountLabel}>Сумма операции 💵</div>
              <div className={styles.amountValue}>{formatMoney(modalAmountValue)}</div>
            </div>

            {modalOperationType === "transfer" && (
              <section className={styles.recipientSection}>
                <h3 className={styles.recipientTitle}>Получатель 🎯</h3>
                <div className={styles.recipientList}>
                  {modalRecipients.map((recipient) => (
                    <button
                      key={recipient.id}
                      type="button"
                      className={`${styles.recipientItem} ${effectiveModalRecipientId === recipient.id ? styles.recipientItemSelected : ""}`}
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
                Сумма операции
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
