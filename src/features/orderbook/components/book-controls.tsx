import type { ChangeEvent } from "react";
import { BOOK_AGGREGATIONS, priceIncrementFor } from "../model";
import type { AggregationPosition, Coin, Denomination } from "../model";
import styles from "../order-book.module.css";

interface BookControlsProps {
  coin: Coin;
  referencePrice: number | null;
  aggregationPosition: AggregationPosition;
  denomination: Denomination;
  onAggregationChange: (position: AggregationPosition) => void;
  onDenominationChange: (denomination: Denomination) => void;
}

export function BookControls({
  coin,
  referencePrice,
  aggregationPosition,
  denomination,
  onAggregationChange,
  onDenominationChange,
}: BookControlsProps) {
  const handleAggregation = (event: ChangeEvent<HTMLSelectElement>) => {
    onAggregationChange(Number(event.target.value) as AggregationPosition);
  };

  const handleDenomination = (event: ChangeEvent<HTMLSelectElement>) => {
    onDenominationChange(event.target.value as Denomination);
  };

  return (
    <div className={styles.footer}>
      <label className={styles.control}>
        <span className={styles.srOnly}>Price increment</span>
        <select
          value={aggregationPosition}
          onChange={handleAggregation}
        >
          {BOOK_AGGREGATIONS.map((aggregation, position) => {
            const liveIncrement =
              referencePrice === null
                ? null
                : priceIncrementFor(
                    referencePrice,
                    aggregation.nSigFigs,
                    aggregation.mantissa,
                  );

            return (
              <option key={position} value={position}>
                {liveIncrement ?? aggregation.priceIncrement[coin]}
              </option>
            );
          })}
        </select>
      </label>
      <label className={`${styles.control} ${styles.controlEnd}`}>
        <span className={styles.srOnly}>Denomination</span>
        <select value={denomination} onChange={handleDenomination}>
          <option value="base">{coin}</option>
          <option value="usd">USD</option>
        </select>
      </label>
    </div>
  );
}
