import type { BookRow as BookRowModel, Denomination } from "../model";
import { BookRow, type RowHoverHandler } from "./book-row";
import styles from "../order-book.module.css";

interface BookSideProps {
  side: "ask" | "bid";
  rows: BookRowModel[];
  denomination: Denomination;
  hoveredIndex: number | null;
  tooltipId: string;
  onRowHover: RowHoverHandler;
  onHoverEnd: () => void;
  onDismiss: () => void;
}

export function BookSide({
  side,
  rows,
  denomination,
  hoveredIndex,
  tooltipId,
  onRowHover,
  onHoverEnd,
  onDismiss,
}: BookSideProps) {
  return (
    <div
      className={styles.bookSide}
      data-side={side}
      onPointerLeave={onHoverEnd}
    >
      {rows.map((row, index) => (
        <BookRow
          key={row.priceRaw}
          row={row}
          side={side}
          index={index}
          denomination={denomination}
          isBest={side === "ask" ? index === rows.length - 1 : index === 0}
          isTooltipAnchor={hoveredIndex === index}
          isTooltipRange={
            hoveredIndex !== null &&
            (side === "ask" ? index >= hoveredIndex : index <= hoveredIndex)
          }
          tooltipId={tooltipId}
          onHover={onRowHover}
          onHoverEnd={onHoverEnd}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
