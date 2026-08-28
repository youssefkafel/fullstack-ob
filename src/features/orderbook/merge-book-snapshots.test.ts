import { describe, expect, it } from "vitest";
import { mergeBookSnapshots } from "./merge-book-snapshots";
import type { WsBook, WsLevel } from "./model";

function level(price: number): WsLevel {
  return { px: String(price), sz: "1", n: 1 };
}

function descendingLevels(start: number, count: number): WsLevel[] {
  return Array.from({ length: count }, (_, index) => level(start - index));
}

function ascendingLevels(start: number, count: number): WsLevel[] {
  return Array.from({ length: count }, (_, index) => level(start + index));
}

function prices(levels: WsLevel[]): number[] {
  return levels.map(({ px }) => Number(px));
}

function expectUniquePrices(levels: WsLevel[]): void {
  const sidePrices = prices(levels);
  expect(new Set(sidePrices).size).toBe(sidePrices.length);
}

describe("mergeBookSnapshots", () => {
  const slow: WsBook = {
    coin: "BTC",
    levels: [descendingLevels(100, 20), ascendingLevels(101, 20)],
    time: 100,
  };

  it("fills a short nonempty fast side from strictly worse slow depth", () => {
    const fast: WsBook = {
      coin: "BTC",
      levels: [descendingLevels(100, 3), ascendingLevels(101, 5)],
      time: 200,
    };

    const merged = mergeBookSnapshots(fast, slow);

    expect(merged).not.toBeNull();
    const [bids, asks] = merged!.levels;
    expect(bids).toHaveLength(20);
    expect(asks).toHaveLength(20);
    expect(bids.slice(0, fast.levels[0].length)).toEqual(fast.levels[0]);
    expect(asks.slice(0, fast.levels[1].length)).toEqual(fast.levels[1]);

    const worstFastBid = Number(fast.levels[0].at(-1)!.px);
    const worstFastAsk = Number(fast.levels[1].at(-1)!.px);
    expect(
      bids
        .slice(fast.levels[0].length)
        .every(({ px }) => Number(px) < worstFastBid),
    ).toBe(true);
    expect(
      asks
        .slice(fast.levels[1].length)
        .every(({ px }) => Number(px) > worstFastAsk),
    ).toBe(true);
    expect(prices(bids)).toEqual(
      descendingLevels(100, 20).map(({ px }) => Number(px)),
    );
    expect(prices(asks)).toEqual(
      ascendingLevels(101, 20).map(({ px }) => Number(px)),
    );
    expectUniquePrices(bids);
    expectUniquePrices(asks);
  });

  it("falls back to slow depth when a fast side is empty", () => {
    const fast: WsBook = {
      coin: "BTC",
      levels: [[], ascendingLevels(101, 5)],
      time: 200,
    };

    const merged = mergeBookSnapshots(fast, slow);

    expect(merged?.levels).toEqual(slow.levels);
    expect(merged?.coin).toBe(fast.coin);
    expect(merged?.time).toBe(fast.time);
    expect(merged?.levels[0]).toHaveLength(20);
    expect(merged?.levels[1]).toHaveLength(20);
  });

  it("falls back to the coherent slow snapshot when strict tails cannot fill both sides", () => {
    const fast: WsBook = {
      coin: "BTC",
      levels: [descendingLevels(90, 3), ascendingLevels(111, 5)],
      time: 200,
    };

    const merged = mergeBookSnapshots(fast, slow);

    expect(merged?.levels).toEqual(slow.levels);
    expect(merged?.coin).toBe(fast.coin);
    expect(merged?.time).toBe(fast.time);
    expect(merged?.levels[0]).toHaveLength(20);
    expect(merged?.levels[1]).toHaveLength(20);
  });

  it("keeps a fresh 19-level strict merge instead of falling back", () => {
    const fast: WsBook = {
      coin: "BTC",
      levels: [descendingLevels(99, 3), ascendingLevels(102, 3)],
      time: 200,
    };

    const merged = mergeBookSnapshots(fast, slow);

    expect(merged?.time).toBe(fast.time);
    expect(merged?.levels[0]).toHaveLength(19);
    expect(merged?.levels[1]).toHaveLength(19);
    expect(merged?.levels[0].slice(0, 3)).toEqual(fast.levels[0]);
    expect(merged?.levels[1].slice(0, 3)).toEqual(fast.levels[1]);
  });

  it("keeps snapshot freshness gating unchanged", () => {
    const fast: WsBook = {
      coin: "BTC",
      levels: [descendingLevels(100, 5), ascendingLevels(101, 5)],
      time: 200,
    };
    const newerSlow: WsBook = { ...slow, time: 300 };

    expect(mergeBookSnapshots(fast, null)).toBeNull();
    expect(mergeBookSnapshots(fast, newerSlow)).toBe(newerSlow);
  });
});
