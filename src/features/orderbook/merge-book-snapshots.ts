import { isWsLevel, type WsBook, type WsLevel } from "./model";

const FAST_LEVEL_LIMIT = 5;
const MERGED_LEVEL_LIMIT = 20;
// Keep in sync with normalizeBook's default visible-row limit.
const PUBLISH_LEVEL_REQUIREMENT = 12;

type BookSnapshotKind = "fast" | "slow";

interface ClassifiedBookSnapshot {
  kind: BookSnapshotKind;
  snapshot: WsBook;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    !bids.every(isWsLevel) ||
    !asks.every(isWsLevel)
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
  if (fast.length === 0) return [];

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

  const mergedBids = mergeSide(fast.levels[0], slow.levels[0], "bid");
  const mergedAsks = mergeSide(fast.levels[1], slow.levels[1], "ask");
  const useSlowDepth =
    mergedBids.length <
      Math.min(slow.levels[0].length, PUBLISH_LEVEL_REQUIREMENT) ||
    mergedAsks.length <
      Math.min(slow.levels[1].length, PUBLISH_LEVEL_REQUIREMENT);

  return {
    coin: fast.coin,
    levels: useSlowDepth ? slow.levels : [mergedBids, mergedAsks],
    time: fast.time,
  };
}
