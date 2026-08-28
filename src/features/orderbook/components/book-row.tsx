import {
  memo,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { BookRow as BookRowModel, Denomination } from "../model";
import styles from "../order-book.module.css";

const sizeFormats: Record<Denomination, Intl.NumberFormat> = {
  base: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  }),
  usd: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
};

export type RowHoverHandler = (
  side: "ask" | "bid",
  index: number,
  element: HTMLDivElement,
) => void;

interface BookRowProps {
  row: BookRowModel;
  side: "ask" | "bid";
  index: number;
  denomination: Denomination;
  isTooltipAnchor: boolean;
  isTooltipRange: boolean;
  tooltipId: string;
  onHover: RowHoverHandler;
}

export const BookRow = memo(function BookRow({
  row,
  side,
  index,
  denomination,
  isTooltipAnchor,
  isTooltipRange,
  tooltipId,
  onHover,
}: BookRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const format = sizeFormats[denomination];
  const size = denomination === "base" ? row.size : row.usdSize;
  const total = denomination === "base" ? row.baseTotal : row.usdTotal;

  const reportHover = (event: PointerEvent<HTMLDivElement>) => {
    onHover(side, index, event.currentTarget);
  };

  useLayoutEffect(() => {
    if (isTooltipAnchor && rowRef.current) {
      onHover(side, index, rowRef.current);
    }
  }, [index, isTooltipAnchor, onHover, row, side]);

  return (
    <div
      ref={rowRef}
      onPointerEnter={reportHover}
      aria-describedby={isTooltipAnchor ? tooltipId : undefined}
      className={styles.row}
      data-side={side}
      data-change={row.change ?? undefined}
      data-flash-cycle={row.change === null ? undefined : row.flashCycle}
      data-tooltip-range={isTooltipRange || undefined}
      style={
        { "--depth": `${(row.depthRatio * 100).toFixed(2)}%` } as CSSProperties
      }
    >
      <span className={styles.depth} aria-hidden="true" />
      <span className={styles.cell}>{row.priceText}</span>
      <span className={styles.cellNum}>{format.format(size)}</span>
      <span className={styles.cellNum}>{format.format(total)}</span>
    </div>
  );
});
