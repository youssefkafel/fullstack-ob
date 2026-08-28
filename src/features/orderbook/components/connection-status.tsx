import type { ConnectionState } from "../model";
import styles from "../order-book.module.css";

const statusCopy: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline — waiting for network",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <p className={styles.status} data-state={state} role="status">
      <span className={styles.statusDot} aria-hidden="true" />
      {statusCopy[state]}
    </p>
  );
}
