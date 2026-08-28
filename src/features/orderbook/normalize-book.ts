import type {
  BookRow,
  LevelChange,
  NormalizeOptions,
  NormalizedBook,
  WsBook,
  WsLevel,
} from "./model";

const DEFAULT_LIMIT = 12;

interface L2BookEnvelope {
  channel: "l2Book";
  data: WsBook;
}

export function formatDecimalString(raw: string): string {
  const [integer, fraction] = raw.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLevel(value: unknown): value is WsLevel {
  if (!isObject(value)) return false;
  if (
    typeof value.px !== "string" ||
    value.px.trim() === "" ||
    typeof value.sz !== "string" ||
    value.sz.trim() === "" ||
    typeof value.n !== "number" ||
    !Number.isInteger(value.n) ||
    value.n < 0
  ) {
    return false;
  }

  const price = Number(value.px);
  const size = Number(value.sz);
  return Number.isFinite(price) && Number.isFinite(size) && size >= 0;
}

function parseEnvelope(input: unknown, expectedCoin: string): L2BookEnvelope | null {
  if (!isObject(input) || input.channel !== "l2Book" || !isObject(input.data)) {
    return null;
  }

  const { data } = input;
  if (
    data.coin !== expectedCoin ||
    typeof data.time !== "number" ||
    !Number.isFinite(data.time) ||
    !Array.isArray(data.levels) ||
    data.levels.length !== 2
  ) {
    return null;
  }

  const [bids, asks] = data.levels;
  if (
    !Array.isArray(bids) ||
    !Array.isArray(asks) ||
    !bids.every(isLevel) ||
    !asks.every(isLevel)
  ) {
    return null;
  }

  return {
    channel: "l2Book",
    data: {
      coin: data.coin,
      levels: [bids, asks],
      time: data.time,
    },
  };
}

function levelChange(
  priceRaw: string,
  size: number,
  previousByPrice: ReadonlyMap<string, BookRow> | null,
): LevelChange {
  if (!previousByPrice) return null;
  const previousSize = previousByPrice.get(priceRaw)?.size;
  if (previousSize === undefined) return "new";
  if (size > previousSize) return "up";
  if (size < previousSize) return "down";
  return null;
}

function accumulate(
  levels: WsLevel[],
  previousByPrice: ReadonlyMap<string, BookRow> | null,
): BookRow[] {
  let baseTotal = 0;
  let usdTotal = 0;

  return levels.map((level) => {
    const price = Number(level.px);
    const size = Number(level.sz);
    const usdSize = price * size;
    baseTotal += size;
    usdTotal += usdSize;
    const change = levelChange(level.px, size, previousByPrice);
    const previousRow = previousByPrice?.get(level.px);
    const flashCycle =
      previousRow && change !== null
        ? previousRow.flashCycle === 0
          ? 1
          : 0
        : (previousRow?.flashCycle ?? 0);

    return {
      priceRaw: level.px,
      priceText: formatDecimalString(level.px),
      price,
      size,
      orderCount: level.n,
      baseTotal,
      usdSize,
      usdTotal,
      depthRatio: 0,
      change,
      flashCycle,
    };
  });
}

function rowsEqual(left: BookRow, right: BookRow): boolean {
  return (
    Object.is(left.priceRaw, right.priceRaw) &&
    Object.is(left.priceText, right.priceText) &&
    Object.is(left.price, right.price) &&
    Object.is(left.size, right.size) &&
    Object.is(left.orderCount, right.orderCount) &&
    Object.is(left.baseTotal, right.baseTotal) &&
    Object.is(left.usdSize, right.usdSize) &&
    Object.is(left.usdTotal, right.usdTotal) &&
    Object.is(left.depthRatio, right.depthRatio) &&
    Object.is(left.change, right.change) &&
    Object.is(left.flashCycle, right.flashCycle)
  );
}

function reconcileRows(
  rows: BookRow[],
  previousByPrice: ReadonlyMap<string, BookRow> | null,
): BookRow[] {
  if (!previousByPrice) return rows;

  return rows.map((row) => {
    const previousRow = previousByPrice.get(row.priceRaw);
    return previousRow && rowsEqual(row, previousRow) ? previousRow : row;
  });
}

export function normalizeBook(
  input: unknown,
  options: NormalizeOptions,
): NormalizedBook | null {
  const envelope = parseEnvelope(input, options.coin);
  if (!envelope) return null;

  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) return null;

  const [bids, asks] = envelope.data.levels;
  const bidsBestFirst = [...bids]
    .sort((a, b) => Number(b.px) - Number(a.px))
    .slice(0, limit);
  const asksBestFirst = [...asks]
    .sort((a, b) => Number(a.px) - Number(b.px))
    .slice(0, limit);
  if (bidsBestFirst.length === 0 || asksBestFirst.length === 0) return null;

  const previous = options.previous?.coin === options.coin ? options.previous : null;
  const previousBidsByPrice = previous
    ? new Map(previous.bids.map((row) => [row.priceRaw, row]))
    : null;
  const previousAsksByPrice = previous
    ? new Map(previous.asks.map((row) => [row.priceRaw, row]))
    : null;
  const bidRows = accumulate(bidsBestFirst, previousBidsByPrice);
  const askRowsBestFirst = accumulate(asksBestFirst, previousAsksByPrice);
  const totalKey = options.denomination === "base" ? "baseTotal" : "usdTotal";
  const maximum = Math.max(
    ...bidRows.map((row) => row[totalKey]),
    ...askRowsBestFirst.map((row) => row[totalKey]),
  );

  for (const row of [...bidRows, ...askRowsBestFirst]) {
    row.depthRatio = maximum === 0 ? 0 : row[totalKey] / maximum;
  }

  const reconciledBidRows = reconcileRows(bidRows, previousBidsByPrice);
  const reconciledAskRowsBestFirst = reconcileRows(
    askRowsBestFirst,
    previousAsksByPrice,
  );

  const bestBid = reconciledBidRows[0].price;
  const bestAsk = reconciledAskRowsBestFirst[0].price;
  const spread = bestAsk - bestBid;
  const midpoint = (bestAsk + bestBid) / 2;

  return {
    coin: options.coin,
    time: envelope.data.time,
    asks: reconciledAskRowsBestFirst.reverse(),
    bids: reconciledBidRows,
    spread,
    spreadBps: midpoint === 0 ? 0 : (spread / midpoint) * 10_000,
  };
}
