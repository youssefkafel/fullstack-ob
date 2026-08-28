export type Coin = "BTC" | "ETH";
export type ProtocolSigFigs = 2 | 3 | 4 | 5;
export type BookMantissa = 2 | 5;

export function priceIncrementFor(
  referencePrice: number,
  nSigFigs: ProtocolSigFigs,
  mantissa?: BookMantissa,
): string | null {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  const incrementMantissa = mantissa ?? 1;

  const exponent = Math.floor(Math.log10(referencePrice)) - nSigFigs + 1;
  return exponent >= 0
    ? `${incrementMantissa}${"0".repeat(exponent)}`
    : `0.${"0".repeat(-exponent - 1)}${incrementMantissa}`;
}

export type AggregationPosition = 0 | 1 | 2 | 3 | 4 | 5;
export type Denomination = "base" | "usd";
export type ConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";
export type LevelChange = "new" | "up" | "down" | null;

interface AggregationDefinition {
  nSigFigs: ProtocolSigFigs;
  mantissa?: BookMantissa;
  priceIncrement: Record<Coin, string>;
}

export const BOOK_AGGREGATIONS: readonly AggregationDefinition[] = [
  { nSigFigs: 5, priceIncrement: { BTC: "1", ETH: "0.1" } },
  { nSigFigs: 5, mantissa: 2, priceIncrement: { BTC: "2", ETH: "0.2" } },
  { nSigFigs: 5, mantissa: 5, priceIncrement: { BTC: "5", ETH: "0.5" } },
  { nSigFigs: 4, priceIncrement: { BTC: "10", ETH: "1" } },
  { nSigFigs: 3, priceIncrement: { BTC: "100", ETH: "10" } },
  { nSigFigs: 2, priceIncrement: { BTC: "1000", ETH: "100" } },
];

export interface BookSelection {
  coin: Coin;
  nSigFigs: ProtocolSigFigs;
  mantissa?: BookMantissa;
}

export function bookSelectionsEqual(
  left: BookSelection,
  right: BookSelection,
): boolean {
  return (
    left.coin === right.coin &&
    left.nSigFigs === right.nSigFigs &&
    left.mantissa === right.mantissa
  );
}

export function selectionForAggregation(
  coin: Coin,
  position: AggregationPosition,
): BookSelection {
  const { nSigFigs, mantissa } = BOOK_AGGREGATIONS[position];
  return {
    coin,
    nSigFigs,
    ...(mantissa === undefined ? {} : { mantissa }),
  };
}

export function aggregationPositionForSelection(
  selection: BookSelection,
): AggregationPosition {
  const position = BOOK_AGGREGATIONS.findIndex(
    ({ nSigFigs, mantissa }) =>
      nSigFigs === selection.nSigFigs && mantissa === selection.mantissa,
  );
  if (position === -1) {
    throw new Error("Unsupported order-book aggregation selection");
  }
  return position as AggregationPosition;
}

export interface WsLevel {
  px: string;
  sz: string;
  n: number;
}

export interface WsBook {
  coin: string;
  levels: [WsLevel[], WsLevel[]];
  time: number;
}

export interface BookRow {
  priceRaw: string;
  priceText: string;
  price: number;
  size: number;
  baseTotal: number;
  usdSize: number;
  usdTotal: number;
  depthRatio: number;
  change: LevelChange;
  flashCycle: 0 | 1;
}

export interface NormalizedBook {
  coin: Coin;
  time: number;
  asks: BookRow[];
  bids: BookRow[];
  spread: number;
  spreadBps: number;
}

export interface NormalizeOptions {
  coin: Coin;
  denomination: Denomination;
  previous?: NormalizedBook | null;
  limit?: number;
}

export interface OrderBookViewState {
  selection: BookSelection;
  denomination: Denomination;
  connection: ConnectionState;
  book: NormalizedBook | null;
  lastUpdateAt: number | null;
}
