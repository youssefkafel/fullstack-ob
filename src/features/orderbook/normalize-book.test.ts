import { describe, expect, it } from "vitest";
import { normalizeBook } from "./normalize-book";

function btcBook(size: string, time: number) {
  return {
    channel: "l2Book",
    data: {
      coin: "BTC",
      levels: [
        [{ px: "100000", sz: size, n: 1 }],
        [{ px: "100001", sz: "2", n: 1 }],
      ],
      time,
    },
  };
}

function multiLevelBtcBook(bestBidSize: string, time: number) {
  return {
    channel: "l2Book",
    data: {
      coin: "BTC",
      levels: [
        [
          { px: "100000", sz: bestBidSize, n: 1 },
          { px: "99999", sz: "2", n: 1 },
        ],
        [
          { px: "100001", sz: "1", n: 1 },
          { px: "100002", sz: "2", n: 1 },
        ],
      ],
      time,
    },
  };
}

describe("normalizeBook", () => {
  it("alternates the flash cycle for consecutive size increases at one price", () => {
    const baseline = normalizeBook(btcBook("1", 1), {
      coin: "BTC",
      denomination: "base",
    });
    expect(baseline).not.toBeNull();

    const firstIncrease = normalizeBook(btcBook("2", 2), {
      coin: "BTC",
      denomination: "base",
      previous: baseline,
    });
    expect(firstIncrease).not.toBeNull();

    const secondIncrease = normalizeBook(btcBook("3", 3), {
      coin: "BTC",
      denomination: "base",
      previous: firstIncrease,
    });
    expect(secondIncrease).not.toBeNull();

    expect(baseline!.bids[0]).toMatchObject({ change: null, flashCycle: 0 });
    expect(firstIncrease!.bids[0]).toMatchObject({
      change: "up",
      flashCycle: 1,
    });
    expect(secondIncrease!.bids[0]).toMatchObject({
      change: "up",
      flashCycle: 0,
    });
  });

  it("reuses every unchanged row from an identical later snapshot", () => {
    const first = normalizeBook(multiLevelBtcBook("1", 1), {
      coin: "BTC",
      denomination: "base",
    });
    expect(first).not.toBeNull();

    const later = normalizeBook(multiLevelBtcBook("1", 2), {
      coin: "BTC",
      denomination: "base",
      previous: first,
    });
    expect(later).not.toBeNull();

    first!.bids.forEach((row, index) => {
      expect(later!.bids[index]).toBe(row);
    });
    first!.asks.forEach((row, index) => {
      expect(later!.asks[index]).toBe(row);
    });
  });

  it("does not reuse a deeper row when a better level changes its cumulative fields", () => {
    const first = normalizeBook(multiLevelBtcBook("1", 1), {
      coin: "BTC",
      denomination: "base",
    });
    expect(first).not.toBeNull();

    const later = normalizeBook(multiLevelBtcBook("2", 2), {
      coin: "BTC",
      denomination: "base",
      previous: first,
    });
    expect(later).not.toBeNull();

    expect(later!.bids[1]).toMatchObject({
      priceRaw: first!.bids[1].priceRaw,
      size: first!.bids[1].size,
    });
    expect(later!.bids[1].baseTotal).not.toBe(first!.bids[1].baseTotal);
    expect(later!.bids[1]).not.toBe(first!.bids[1]);
  });
});
