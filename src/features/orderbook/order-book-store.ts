import {
  HyperliquidBookClient,
  type BookClientCallbacks,
} from "./hyperliquid-book-client";
import { normalizeBook } from "./normalize-book";
import { bookSelectionsEqual } from "./model";
import type {
  BookSelection,
  ConnectionState,
  Denomination,
  OrderBookViewState,
} from "./model";

export interface BookClientHandle {
  start(): void;
  setSelection(selection: BookSelection): void;
  dispose(): void;
}

export type BookClientFactory = (
  selection: BookSelection,
  callbacks: BookClientCallbacks,
) => BookClientHandle;

export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

const createBookClient: BookClientFactory = (selection, callbacks) =>
  new HyperliquidBookClient(selection, callbacks);

const browserFrameScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (id) => window.cancelAnimationFrame(id),
};

export class OrderBookStore {
  private readonly clientFactory: BookClientFactory;
  private readonly frameScheduler: FrameScheduler;
  private readonly initialSnapshot: OrderBookViewState;
  private readonly listeners = new Set<() => void>();

  private snapshot: OrderBookViewState;
  private client: BookClientHandle | null = null;
  private generation = 0;
  private frameId: number | null = null;
  private latestRaw: unknown;
  private pendingRaw: unknown;
  private hasLatestRaw = false;
  private hasPendingRaw = false;
  private suppressNextPreviousBook = false;
  private started = false;
  private disposed = false;

  constructor(
    initial: BookSelection,
    clientFactory: BookClientFactory = createBookClient,
    frameScheduler: FrameScheduler = browserFrameScheduler,
  ) {
    const selection = { ...initial };
    this.clientFactory = clientFactory;
    this.frameScheduler = frameScheduler;
    this.initialSnapshot = {
      selection,
      denomination: "base",
      connection: "connecting",
      book: null,
      lastUpdateAt: null,
    };
    this.snapshot = this.initialSnapshot;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.startClient();
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): OrderBookViewState => this.snapshot;

  getServerSnapshot = (): OrderBookViewState => this.initialSnapshot;

  setSelection(selection: BookSelection): void {
    if (
      this.disposed ||
      bookSelectionsEqual(this.snapshot.selection, selection)
    ) {
      return;
    }
    const sameCoin = this.snapshot.selection.coin === selection.coin;
    const retainedBook = sameCoin ? this.snapshot.book : null;
    const retainedLastUpdateAt = sameCoin ? this.snapshot.lastUpdateAt : null;

    this.generation += 1;
    this.cancelFrame();
    this.clearRaw();
    this.suppressNextPreviousBook = sameCoin && retainedBook !== null;

    this.publish({
      selection: { ...selection },
      denomination: this.snapshot.denomination,
      connection: this.snapshot.connection,
      book: retainedBook,
      lastUpdateAt: retainedLastUpdateAt,
    });

    this.client?.setSelection(selection);
  }

  setDenomination(denomination: Denomination): void {
    if (this.disposed || denomination === this.snapshot.denomination) return;

    const consumedPendingRaw = this.hasPendingRaw;
    if (consumedPendingRaw) {
      this.hasPendingRaw = false;
      this.pendingRaw = undefined;
    }

    const book = this.hasLatestRaw
      ? normalizeBook(this.latestRaw, {
          coin: this.snapshot.selection.coin,
          denomination,
          previous: this.suppressNextPreviousBook
            ? null
            : this.snapshot.book,
        })
      : this.snapshot.book;
    if (book && this.hasLatestRaw) {
      this.suppressNextPreviousBook = false;
    }

    this.publish({
      ...this.snapshot,
      denomination,
      book: book ?? this.snapshot.book,
      lastUpdateAt:
        consumedPendingRaw && book ? Date.now() : this.snapshot.lastUpdateAt,
    });
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.generation += 1;
    this.client?.dispose();
    this.client = null;
    this.cancelFrame();
    this.clearRaw();
    this.suppressNextPreviousBook = false;
    this.listeners.clear();
  }

  private startClient(): void {
    const client = this.clientFactory(this.snapshot.selection, {
      onSnapshot: (message) =>
        this.handleSnapshot(this.generation, message),
      onState: (state) => this.handleState(state),
    });
    if (this.disposed) {
      client.dispose();
      return;
    }

    this.client = client;
    client.start();
  }

  private handleSnapshot(generation: number, message: unknown): void {
    if (this.disposed || generation !== this.generation) return;

    this.latestRaw = message;
    this.hasLatestRaw = true;
    this.pendingRaw = message;
    this.hasPendingRaw = true;
    if (this.frameId !== null) return;

    this.frameId = this.frameScheduler.request(() => {
      if (this.disposed || generation !== this.generation) return;

      this.frameId = null;
      if (!this.hasPendingRaw) return;

      const raw = this.pendingRaw;
      this.pendingRaw = undefined;
      this.hasPendingRaw = false;
      const book = normalizeBook(raw, {
        coin: this.snapshot.selection.coin,
        denomination: this.snapshot.denomination,
        previous: this.suppressNextPreviousBook ? null : this.snapshot.book,
      });
      if (!book) return;
      this.suppressNextPreviousBook = false;

      this.publish({
        ...this.snapshot,
        book,
        lastUpdateAt: Date.now(),
      });
    });
  }

  private handleState(connection: ConnectionState): void {
    if (this.disposed) return;
    this.publish({ ...this.snapshot, connection });
  }

  private publish(snapshot: OrderBookViewState): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }

  private cancelFrame(): void {
    if (this.frameId === null) return;
    this.frameScheduler.cancel(this.frameId);
    this.frameId = null;
  }

  private clearRaw(): void {
    this.latestRaw = undefined;
    this.pendingRaw = undefined;
    this.hasLatestRaw = false;
    this.hasPendingRaw = false;
  }
}
