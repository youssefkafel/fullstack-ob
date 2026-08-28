import type { WsBook, WsLevel } from "./model";

const FAST_LEVEL_LIMIT = 5;
const MERGED_LEVEL_LIMIT = 20;

export type BookSnapshotKind = "fast" | "slow";

export interface ClassifiedBookSnapshot {
  kind: BookSnapshotKind;
  snapshot: WsBook;
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

export function classifyBookSnapshot(
  value: unknown,
  expectedCoin: string,
): ClassifiedBookSnapshot | null {
  if (
    !isObject(value) ||
    value.coin !== expectedCoin ||
    typeof value.time !== "number" ||
    !Number.isFinite(value.time) ||
    !Array.isArray(value.levels) ||
    value.levels.length !== 2
  ) {
    return null;
  }

  const [bids, asks] = value.levels;
  if (
    !Array.isArray(bids) ||
    !Array.isArray(asks) ||
    !bids.every(isLevel) ||
    !asks.every(isLevel)
  ) {
    return null;
  }

  return {
    kind:
      bids.length <= FAST_LEVEL_LIMIT && asks.length <= FAST_LEVEL_LIMIT
        ? "fast"
        : "slow",
    snapshot: value as unknown as WsBook,
  };
}

function mergeSide(
  fast: WsLevel[],
  slow: WsLevel[],
  side: "bid" | "ask",
): WsLevel[] {
  if (fast.length < FAST_LEVEL_LIMIT) return fast.slice(0, MERGED_LEVEL_LIMIT);

  const worstFastPrice = Number(fast[fast.length - 1].px);
  const merged = fast.slice(0, MERGED_LEVEL_LIMIT);
  for (const level of slow) {
    if (merged.length >= MERGED_LEVEL_LIMIT) break;
    const price = Number(level.px);
    if (
      (side === "bid" && price < worstFastPrice) ||
      (side === "ask" && price > worstFastPrice)
    ) {
      merged.push(level);
    }
  }
  return merged;
}

export function mergeBookSnapshots(
  fast: WsBook | null,
  slow: WsBook | null,
): WsBook | null {
  if (!slow) return null;
  if (!fast || slow.time > fast.time) return slow;

  return {
    coin: fast.coin,
    levels: [
      mergeSide(fast.levels[0], slow.levels[0], "bid"),
      mergeSide(fast.levels[1], slow.levels[1], "ask"),
    ],
    time: fast.time,
  };
}
