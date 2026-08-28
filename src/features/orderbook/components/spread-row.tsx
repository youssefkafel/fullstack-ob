import styles from "../order-book.module.css";

const spreadFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 6,
});

const bpsFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface SpreadRowProps {
  spread: number;
  spreadBps: number;
}

export function SpreadRow({ spread, spreadBps }: SpreadRowProps) {
  return (
    <div className={styles.spreadRow}>
      <span className={styles.cell}>Spread</span>
      <span className={styles.cellNum}>{spreadFormat.format(spread)}</span>
      <span className={styles.cellNum}>{bpsFormat.format(spreadBps)} bps</span>
    </div>
  );
}
