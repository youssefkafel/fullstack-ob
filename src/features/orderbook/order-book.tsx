"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  BOOK_AGGREGATIONS,
  aggregationPositionForSelection,
  selectionForAggregation,
} from "./model";
import type {
  AggregationPosition,
  Coin,
  ConnectionState,
  Denomination,
} from "./model";
import { OrderBookStore } from "./order-book-store";
import { useOrderBook } from "./use-order-book";
import { MarketHeader } from "./components/market-header";
import { BookSide } from "./components/book-side";
import type { RowHoverHandler } from "./components/book-row";
import { SpreadRow } from "./components/spread-row";
import { BookControls } from "./components/book-controls";
import { ConnectionStatus } from "./components/connection-status";
import styles from "./order-book.module.css";

const TOOLTIP_ID = "book-row-tooltip";
const distanceFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const assetTotalFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
});
const usdcTotalFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const averagePriceFormats = [
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
] as const;

interface HoveredRow {
  side: "ask" | "bid";
  index: number;
  anchorY: number;
}

const emptyCopy: Record<ConnectionState, string> = {
  connecting: "Connecting to Hyperliquid…",
  live: "Waiting for the first book…",
  reconnecting: "Connection lost. Reconnecting…",
  offline: "You're offline. The book resumes when the network returns.",
};

export function OrderBook() {
  const [store] = useState(
    () => new OrderBookStore(selectionForAggregation("BTC", 0)),
  );
  const state = useOrderBook(store);
  const shellRef = useRef<HTMLElement>(null);
  const [hoveredRow, setHoveredRow] = useState<HoveredRow | null>(null);

  useEffect(() => {
    store.start();
    return () => store.dispose();
  }, [store]);

  const handleRowHover = useCallback<RowHoverHandler>((side, index, element) => {
    const shell = shellRef.current;
    if (!shell) return;
    const shellRect = shell.getBoundingClientRect();
    const rowRect = element.getBoundingClientRect();
    const anchorY = rowRect.top - shellRect.top + rowRect.height / 2;
    setHoveredRow((current) =>
      current?.side === side &&
      current.index === index &&
      current.anchorY === anchorY
        ? current
        : { side, index, anchorY },
    );
  }, []);

  const clearHoveredRow = useCallback(() => setHoveredRow(null), []);

  const handleCoinChange = (coin: Coin) => {
    clearHoveredRow();
    store.setSelection({ ...state.selection, coin });
  };

  const handleAggregationChange = (position: AggregationPosition) => {
    clearHoveredRow();
    store.setSelection(selectionForAggregation(state.selection.coin, position));
  };

  const handleDenominationChange = (denomination: Denomination) => {
    store.setDenomination(denomination);
  };

  const unit = state.denomination === "base" ? state.selection.coin : "USD";
  const aggregationPosition = aggregationPositionForSelection(state.selection);
  const bestAsk = state.book?.asks.at(-1);
  const bestBid = state.book?.bids[0];
  const hoveredBookRow =
    hoveredRow && state.book
      ? state.book[hoveredRow.side === "ask" ? "asks" : "bids"][
          hoveredRow.index
        ]
      : undefined;
  const midpoint =
    bestAsk &&
    bestBid &&
    Number.isFinite(bestAsk.price) &&
    bestAsk.price > 0 &&
    Number.isFinite(bestBid.price) &&
    bestBid.price > 0
      ? (bestAsk.price + bestBid.price) / 2
      : Number.NaN;
  const referencePrice =
    state.book?.coin === state.selection.coin &&
    Number.isFinite(midpoint) &&
    midpoint > 0
      ? midpoint
      : null;
  const distancePercent = hoveredBookRow
    ? (Math.abs(hoveredBookRow.price - midpoint) / midpoint) * 100
    : Number.NaN;
  const averagePrice = hoveredBookRow
    ? hoveredBookRow.usdTotal / hoveredBookRow.baseTotal
    : Number.NaN;
  const tooltipMetrics =
    state.connection === "live" &&
    hoveredBookRow &&
    Number.isFinite(midpoint) &&
    midpoint > 0 &&
    Number.isFinite(hoveredBookRow.baseTotal) &&
    hoveredBookRow.baseTotal > 0 &&
    Number.isFinite(hoveredBookRow.usdTotal) &&
    Number.isFinite(distancePercent) &&
    Number.isFinite(averagePrice)
      ? {
          distancePercent,
          averagePrice,
          totalAsset: hoveredBookRow.baseTotal,
          totalUsdc: hoveredBookRow.usdTotal,
        }
      : null;
  const priceIncrement =
    BOOK_AGGREGATIONS[aggregationPosition].priceIncrement[state.selection.coin];
  const priceFractionDigits = priceIncrement.includes(".") ? 1 : 0;

  return (
    <section
      ref={shellRef}
      className={styles.shell}
      aria-label="Live Hyperliquid order book"
    >
      <MarketHeader
        selection={state.selection}
        connection={state.connection}
        onCoinChange={handleCoinChange}
      />
      <h2 className={styles.sectionLabel}>Orders</h2>
      <div className={styles.panel}>
        <div className={styles.panelTitle}>Order Book</div>
        <div className={styles.columns}>
          <span className={styles.cell}>Price</span>
          <span className={styles.cellNum}>Size ({unit})</span>
          <span className={styles.cellNum}>Total ({unit})</span>
        </div>
        {state.book ? (
          <>
            <BookSide
              side="ask"
              rows={state.book.asks}
              denomination={state.denomination}
              hoveredIndex={
                tooltipMetrics && hoveredRow?.side === "ask"
                  ? hoveredRow.index
                  : null
              }
              tooltipId={TOOLTIP_ID}
              onRowHover={handleRowHover}
              onHoverEnd={clearHoveredRow}
            />
            <SpreadRow
              spread={state.book.spread}
              spreadBps={state.book.spreadBps}
            />
            <BookSide
              side="bid"
              rows={state.book.bids}
              denomination={state.denomination}
              hoveredIndex={
                tooltipMetrics && hoveredRow?.side === "bid"
                  ? hoveredRow.index
                  : null
              }
              tooltipId={TOOLTIP_ID}
              onRowHover={handleRowHover}
              onHoverEnd={clearHoveredRow}
            />
          </>
        ) : (
          <div className={styles.emptyState}>
            {emptyCopy[state.connection]}
          </div>
        )}
        <BookControls
          coin={state.selection.coin}
          referencePrice={referencePrice}
          aggregationPosition={aggregationPosition}
          denomination={state.denomination}
          onAggregationChange={handleAggregationChange}
          onDenominationChange={handleDenominationChange}
        />
      </div>
      {tooltipMetrics && hoveredRow ? (
        <div
          id={TOOLTIP_ID}
          role="tooltip"
          className={styles.rowTooltip}
          style={
            {
              "--tooltip-anchor-y": `${hoveredRow.anchorY}px`,
            } as CSSProperties
          }
        >
          <div className={styles.tooltipRow}>
            <span>Distance from Mid</span>
            <span className={styles.tooltipValue}>
              {distanceFormat.format(tooltipMetrics.distancePercent)}%
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span>Average Price</span>
            <span className={styles.tooltipValue}>
              {averagePriceFormats[priceFractionDigits].format(
                tooltipMetrics.averagePrice,
              )}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span>Total ({state.selection.coin})</span>
            <span className={styles.tooltipValue}>
              {assetTotalFormat.format(tooltipMetrics.totalAsset)}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span>Total (USDC)</span>
            <span className={styles.tooltipValue}>
              {usdcTotalFormat.format(tooltipMetrics.totalUsdc)}
            </span>
          </div>
        </div>
      ) : null}
      <ConnectionStatus state={state.connection} />
    </section>
  );
}
