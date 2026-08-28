import {
  classifyBookSnapshot,
  mergeBookSnapshots,
} from "./merge-book-snapshots";
import { bookSelectionsEqual } from "./model";
import type { BookSelection, ConnectionState, WsBook } from "./model";

const SOCKET_URL = "wss://api.hyperliquid.xyz/ws";
const SUBSCRIPTION_READY_TIMEOUT_MS = 3_000;
const HEARTBEAT_AFTER_MS = 30_000;
const MAX_RECONNECT_MS = 10_000;

export interface BookClientCallbacks {
  onSnapshot(message: unknown): void;
  onState(state: ConnectionState): void;
}

export interface BookClientEnvironment {
  createSocket(url: string): WebSocket;
  now(): number;
  random(): number;
  isOnline(): boolean;
  isVisible(): boolean;
  addWindowListener(type: "online" | "offline", listener: EventListener): void;
  removeWindowListener(type: "online" | "offline", listener: EventListener): void;
  addVisibilityListener(listener: EventListener): void;
  removeVisibilityListener(listener: EventListener): void;
}

function createBrowserEnvironment(): BookClientEnvironment {
  return {
    createSocket: (url) => new window.WebSocket(url),
    now: () => Date.now(),
    random: () => Math.random(),
    isOnline: () => navigator.onLine,
    isVisible: () => document.visibilityState === "visible",
    addWindowListener: (type, listener) => window.addEventListener(type, listener),
    removeWindowListener: (type, listener) => window.removeEventListener(type, listener),
    addVisibilityListener: (listener) =>
      document.addEventListener("visibilitychange", listener),
    removeVisibilityListener: (listener) =>
      document.removeEventListener("visibilitychange", listener),
  };
}

function parseMessage(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

interface IncomingMessage {
  channel?: unknown;
  data?: unknown;
}

interface L2BookSubscription {
  type: "l2Book";
  coin: BookSelection["coin"];
  nSigFigs: BookSelection["nSigFigs"];
  mantissa?: BookSelection["mantissa"];
  fast: boolean;
}

interface SubscriptionResponseData {
  method?: unknown;
  subscription?: unknown;
}

type SubscriptionMethod = "subscribe" | "unsubscribe";

interface L2BookSubscriptionPair {
  fast: L2BookSubscription;
  slow: L2BookSubscription;
}

interface PairAcknowledgements {
  fast: boolean;
  slow: boolean;
}

function subscriptionPairForSelection(
  selection: BookSelection,
): L2BookSubscriptionPair {
  const common = {
    type: "l2Book" as const,
    coin: selection.coin,
    nSigFigs: selection.nSigFigs,
    ...(selection.mantissa === undefined
      ? {}
      : { mantissa: selection.mantissa }),
  };
  return {
    fast: { ...common, fast: true },
    slow: { ...common, fast: false },
  };
}

function subscriptionMatches(
  value: unknown,
  expected: L2BookSubscription,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<L2BookSubscription> & {
    mantissa?: unknown;
    fast?: unknown;
  };
  return (
    candidate.type === expected.type &&
    candidate.coin === expected.coin &&
    candidate.nSigFigs === expected.nSigFigs &&
    (candidate.mantissa ?? undefined) === expected.mantissa &&
    (candidate.fast ?? false) === expected.fast
  );
}

function subscriptionPairsMatch(
  left: L2BookSubscriptionPair,
  right: L2BookSubscriptionPair,
): boolean {
  return (
    subscriptionMatches(left.fast, right.fast) &&
    subscriptionMatches(left.slow, right.slow)
  );
}

function sendSubscription(
  socket: WebSocket,
  method: SubscriptionMethod,
  subscription: L2BookSubscription,
): void {
  socket.send(JSON.stringify({ method, subscription }));
}

export class HyperliquidBookClient {
  private environment: BookClientEnvironment | undefined;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptionReadinessTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastBookTime: number | null = null;
  private lastSnapshotAt: number | null = null;
  private lastHeartbeatSentAt: number | null = null;
  private lastTrafficAt: number | null = null;
  private state: ConnectionState | null = null;
  private started = false;
  private disposed = false;
  private desiredSelection: BookSelection;
  private sentPair: L2BookSubscriptionPair | null = null;
  private activePair: L2BookSubscriptionPair | null = null;
  private pairAcknowledgements: PairAcknowledgements = {
    fast: false,
    slow: false,
  };
  private fastSnapshot: WsBook | null = null;
  private slowSnapshot: WsBook | null = null;

  private readonly onlineListener: EventListener = () => this.handleOnline();
  private readonly offlineListener: EventListener = () => this.handleOffline();
  private readonly visibilityListener: EventListener = () =>
    this.handleVisibilityChange();

  constructor(
    selection: BookSelection,
    private readonly callbacks: BookClientCallbacks,
    environment?: BookClientEnvironment,
  ) {
    this.desiredSelection = { ...selection };
    this.environment = environment;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.environment ??= createBrowserEnvironment();

    this.environment.addWindowListener("online", this.onlineListener);
    this.environment.addWindowListener("offline", this.offlineListener);
    this.environment.addVisibilityListener(this.visibilityListener);

    if (!this.environment.isOnline()) {
      this.emitState("offline");
      return;
    }

    this.connect(false);
  }

  setSelection(selection: BookSelection): void {
    if (
      this.disposed ||
      bookSelectionsEqual(this.desiredSelection, selection)
    ) {
      return;
    }

    this.desiredSelection = { ...selection };

    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    if (this.activePair === null && this.sentPair !== null) return;
    this.replaceSubscriptionPair(socket);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.clearReconnectTimer();
    this.clearSocketTimers();

    if (this.environment && this.started) {
      this.environment.removeWindowListener("online", this.onlineListener);
      this.environment.removeWindowListener("offline", this.offlineListener);
      this.environment.removeVisibilityListener(this.visibilityListener);
    }

    this.closeCurrentSocket();
  }

  private connect(reconnecting: boolean): void {
    const environment = this.environment;
    if (!environment || this.disposed || !environment.isOnline()) return;

    this.clearReconnectTimer();
    this.emitState(reconnecting ? "reconnecting" : "connecting");

    let socket: WebSocket;
    try {
      socket = environment.createSocket(SOCKET_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.handleOpen(socket);
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onclose = () => this.handleSocketTermination(socket);
    socket.onerror = () => this.handleSocketError(socket);
  }

  private replaceSubscriptionPair(socket: WebSocket): boolean {
    if (!this.isCurrent(socket) || socket.readyState !== 1) return false;

    const nextPair = subscriptionPairForSelection(this.desiredSelection);
    try {
      if (this.sentPair) {
        sendSubscription(socket, "unsubscribe", this.sentPair.fast);
        sendSubscription(socket, "unsubscribe", this.sentPair.slow);
      }
      sendSubscription(socket, "subscribe", nextPair.fast);
      sendSubscription(socket, "subscribe", nextPair.slow);
    } catch {
      this.terminateSocket(socket);
      return false;
    }

    this.sentPair = nextPair;
    this.activePair = null;
    this.resetPairData();
    this.armSubscriptionReadinessTimeout(socket);
    return true;
  }

  private resetPairData(): void {
    this.pairAcknowledgements = { fast: false, slow: false };
    this.fastSnapshot = null;
    this.slowSnapshot = null;
    this.lastBookTime = null;
  }

  private resetSubscriptions(): void {
    this.sentPair = null;
    this.activePair = null;
    this.resetPairData();
  }

  private handleOpen(socket: WebSocket): void {
    if (!this.isCurrent(socket)) return;

    this.lastHeartbeatSentAt = null;
    this.lastTrafficAt = this.environment!.now();
    this.resetSubscriptions();
    if (!this.replaceSubscriptionPair(socket)) return;
    this.armHeartbeat(socket);
  }

  private handleMessage(socket: WebSocket, rawData: unknown): void {
    if (!this.isCurrent(socket)) return;

    this.lastTrafficAt = this.environment!.now();
    this.armHeartbeat(socket);

    const parsed = parseMessage(rawData);
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as IncomingMessage;
    if (message.channel === "subscriptionResponse") {
      const response =
        typeof message.data === "object" && message.data !== null
          ? (message.data as SubscriptionResponseData)
          : null;
      const sentPair = this.sentPair;
      if (response?.method !== "subscribe" || !sentPair) return;

      if (subscriptionMatches(response.subscription, sentPair.fast)) {
        this.pairAcknowledgements.fast = true;
      } else if (subscriptionMatches(response.subscription, sentPair.slow)) {
        this.pairAcknowledgements.slow = true;
      } else {
        return;
      }

      if (
        !this.pairAcknowledgements.fast ||
        !this.pairAcknowledgements.slow
      ) {
        return;
      }

      const desiredPair = subscriptionPairForSelection(this.desiredSelection);
      if (subscriptionPairsMatch(sentPair, desiredPair)) {
        this.activePair = sentPair;
      } else {
        this.replaceSubscriptionPair(socket);
      }
      return;
    }
    if (message.channel === "pong") return;
    if (message.channel !== "l2Book") return;

    const activePair = this.activePair;
    const desiredPair = subscriptionPairForSelection(this.desiredSelection);
    if (!activePair || !subscriptionPairsMatch(activePair, desiredPair)) return;

    const classified = classifyBookSnapshot(
      message.data,
      activePair.fast.coin,
    );
    if (!classified) return;

    if (classified.kind === "fast") {
      if (
        this.fastSnapshot !== null &&
        classified.snapshot.time < this.fastSnapshot.time
      ) {
        return;
      }
      this.fastSnapshot = classified.snapshot;
    } else {
      if (
        this.slowSnapshot !== null &&
        classified.snapshot.time < this.slowSnapshot.time
      ) {
        return;
      }
      this.slowSnapshot = classified.snapshot;
    }

    const snapshot = mergeBookSnapshots(
      this.fastSnapshot,
      this.slowSnapshot,
    );
    if (
      !snapshot ||
      (this.lastBookTime !== null && snapshot.time < this.lastBookTime)
    ) {
      return;
    }
    if (this.lastBookTime === null) {
      this.clearSubscriptionReadinessTimeout();
    }

    this.lastBookTime = snapshot.time;
    this.lastSnapshotAt = this.environment!.now();
    this.reconnectAttempt = 0;
    this.callbacks.onSnapshot({ channel: "l2Book", data: snapshot });
    this.emitState("live");
  }

  private handleSocketError(socket: WebSocket): void {
    if (!this.isCurrent(socket)) return;
    this.terminateSocket(socket);
  }

  private handleSocketTermination(socket: WebSocket): void {
    if (!this.isCurrent(socket)) return;
    this.detachSocket(socket);
    this.socket = null;
    this.resetSubscriptions();
    this.clearSocketTimers();
    this.scheduleReconnect();
  }

  private terminateSocket(socket: WebSocket): void {
    if (!this.isCurrent(socket)) return;
    this.detachSocket(socket);
    this.socket = null;
    this.resetSubscriptions();
    this.clearSocketTimers();
    try {
      socket.close();
    } finally {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const environment = this.environment;
    if (!environment || this.disposed || this.reconnectTimer !== null) return;
    if (!environment.isOnline()) {
      this.emitState("offline");
      return;
    }

    this.emitState("reconnecting");
    const base = Math.min(500 * 2 ** this.reconnectAttempt, MAX_RECONNECT_MS);
    const delay = Math.round(base * (0.8 + environment.random() * 0.4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(true);
    }, delay);
  }

  private handleOffline(): void {
    if (this.disposed) return;
    this.clearReconnectTimer();
    this.clearSocketTimers();
    this.closeCurrentSocket();
    this.emitState("offline");
  }

  private handleOnline(): void {
    const environment = this.environment;
    if (!environment || this.disposed || !environment.isOnline() || this.socket) return;

    this.clearReconnectTimer();
    this.emitState(this.lastSnapshotAt === null ? "connecting" : "reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.lastSnapshotAt !== null);
    }, 0);
  }

  private handleVisibilityChange(): void {
    if (this.disposed) return;
    const socket = this.socket;
    if (!this.environment?.isVisible() || !socket) {
      this.clearSubscriptionReadinessTimeout();
      return;
    }
    if (this.lastBookTime === null) {
      this.armSubscriptionReadinessTimeout(socket);
    }
  }

  private armSubscriptionReadinessTimeout(socket: WebSocket): void {
    this.clearSubscriptionReadinessTimeout();
    if (
      !this.environment?.isVisible() ||
      !this.isCurrent(socket) ||
      socket.readyState !== 1
    ) {
      return;
    }

    this.subscriptionReadinessTimer = setTimeout(() => {
      this.subscriptionReadinessTimer = null;
      if (
        this.environment?.isVisible() &&
        this.isCurrent(socket) &&
        socket.readyState === 1
      ) {
        this.terminateSocket(socket);
      }
    }, SUBSCRIPTION_READY_TIMEOUT_MS);
  }

  private armHeartbeat(socket: WebSocket): void {
    this.clearHeartbeatTimer();
    const environment = this.environment;
    if (!environment || this.lastTrafficAt === null || !this.isCurrent(socket)) return;

    const heartbeatBaseline = Math.max(
      this.lastTrafficAt,
      this.lastHeartbeatSentAt ?? Number.NEGATIVE_INFINITY,
    );
    const remaining = HEARTBEAT_AFTER_MS - (environment.now() - heartbeatBaseline);
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.isCurrent(socket) || socket.readyState !== 1) return;

      const silence = this.environment!.now() - this.lastTrafficAt!;
      if (silence < HEARTBEAT_AFTER_MS) {
        this.armHeartbeat(socket);
        return;
      }

      try {
        socket.send(JSON.stringify({ method: "ping" }));
      } catch {
        this.terminateSocket(socket);
        return;
      }
      this.lastHeartbeatSentAt = this.environment!.now();
      this.armHeartbeat(socket);
    }, Math.max(0, remaining));
  }

  private closeCurrentSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.detachSocket(socket);
    this.socket = null;
    this.resetSubscriptions();
    try {
      socket.close();
    } catch {
      // Closing is best-effort; handlers are already detached.
    }
  }

  private detachSocket(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  private isCurrent(socket: WebSocket): boolean {
    return !this.disposed && this.socket === socket;
  }

  private emitState(state: ConnectionState): void {
    if (this.disposed || this.state === state) return;
    this.state = state;
    this.callbacks.onState(state);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearSubscriptionReadinessTimeout(): void {
    if (this.subscriptionReadinessTimer === null) return;
    clearTimeout(this.subscriptionReadinessTimer);
    this.subscriptionReadinessTimer = null;
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer === null) return;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearSocketTimers(): void {
    this.clearSubscriptionReadinessTimeout();
    this.clearHeartbeatTimer();
  }
}
