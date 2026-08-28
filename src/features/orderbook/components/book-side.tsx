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

function isBestLevel(
  side: "ask" | "bid",
  index: number,
  rowCount: number,
): boolean {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(rowCount) ||
    rowCount <= 0 ||
    index < 0 ||
    index >= rowCount
  ) {
    return false;
  }

  return side === "ask" ? index === rowCount - 1 : index === 0;
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
          isBest={isBestLevel(side, index, rows.length)}
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
