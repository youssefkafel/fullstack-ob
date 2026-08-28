import type { ChangeEvent } from "react";
import type { BookSelection, Coin, ConnectionState } from "../model";
import styles from "../order-book.module.css";

const MARKET_LABELS: Record<Coin, string> = {
  BTC: "BTC/USDC",
  ETH: "ETH/USDC",
};

interface MarketHeaderProps {
  selection: BookSelection;
  connection: ConnectionState;
  onCoinChange: (coin: Coin) => void;
}

export function MarketHeader({
  selection,
  connection,
  onCoinChange,
}: MarketHeaderProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onCoinChange(event.target.value as Coin);
  };

  return (
    <header className={styles.marketHeader}>
      <span
        className={styles.marketLogo}
        data-coin={selection.coin}
        aria-hidden="true"
      />
      <div className={styles.marketMeta}>
        <h1 className={styles.marketName}>{MARKET_LABELS[selection.coin]}</h1>
        <div className={styles.marketKind}>Perpetuals</div>
      </div>
      <span
        className={styles.headerDot}
        data-state={connection}
        aria-hidden="true"
      />
      <span className={styles.marketChevron} aria-hidden="true" />
      <label className={styles.marketSelect}>
        <span className={styles.srOnly}>Market</span>
        <select value={selection.coin} onChange={handleChange}>
          <option value="BTC">{MARKET_LABELS.BTC}</option>
          <option value="ETH">{MARKET_LABELS.ETH}</option>
        </select>
      </label>
    </header>
  );
}
