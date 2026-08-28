"use client";

import { useSyncExternalStore } from "react";
import type { OrderBookViewState } from "./model";
import type { OrderBookStore } from "./order-book-store";

export function useOrderBook(store: OrderBookStore): OrderBookViewState {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
