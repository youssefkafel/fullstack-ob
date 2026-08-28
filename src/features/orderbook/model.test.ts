import { describe, expect, it } from "vitest";
import { priceIncrementFor } from "./model";
import type { BookMantissa, ProtocolSigFigs } from "./model";

describe("priceIncrementFor", () => {
  it.each<
    [
      referencePrice: number,
      nSigFigs: ProtocolSigFigs,
      mantissa: BookMantissa | undefined,
      expected: string,
    ]
  >([
    [99_999, 5, undefined, "1"],
    [100_000, 5, undefined, "10"],
    [9_999, 5, undefined, "0.1"],
    [10_000, 5, undefined, "1"],
    [99_999, 5, 2, "2"],
    [99_999, 5, 5, "5"],
    [99_999, 4, undefined, "10"],
  ])(
    "reference price %s with %s sig figs and mantissa %s returns %s",
    (referencePrice, nSigFigs, mantissa, expected) => {
      expect(priceIncrementFor(referencePrice, nSigFigs, mantissa)).toBe(
        expected,
      );
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns null for invalid reference price %s",
    (referencePrice) => {
      expect(priceIncrementFor(referencePrice, 5)).toBeNull();
    },
  );
});
