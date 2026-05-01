"use client";

import { useState } from "react";
import type { StatusPayload } from "@/lib/types";
import CollapsibleBlock from "./CollapsibleBlock";

type Props = {
  payload: StatusPayload;
};

const STATUS_VISIBLE_WHEN_COLLAPSED = 5;

export default function StatusTable({ payload }: Props) {
  const nameHeader = payload.nameHeader ?? "Component";
  const statusHeader = payload.statusHeader ?? "Status";

  const overflows = payload.rows.length > STATUS_VISIBLE_WHEN_COLLAPSED;
  const [expanded, setExpanded] = useState(!overflows);

  const visibleRows =
    overflows && !expanded
      ? payload.rows.slice(0, STATUS_VISIBLE_WHEN_COLLAPSED)
      : payload.rows;

  const hiddenCount = payload.rows.length - STATUS_VISIBLE_WHEN_COLLAPSED;

  const header = (
    <>
      <span className="status-tag">STATUS</span>
    </>
  );

  const pill = (
    <span className="status-count">
      {payload.rows.length} {payload.rows.length === 1 ? "row" : "rows"}
    </span>
  );

  return (
    <CollapsibleBlock
      className="status-table"
      headerClassName="block-summary status-table-header"
      header={header}
      pill={pill}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      partialFooterLabel={overflows ? `Show ${hiddenCount} more` : undefined}
    >
      <div className="status-row header">
        <span>{nameHeader}</span>
        <span>{statusHeader}</span>
      </div>
      {visibleRows.map((row, i) => (
        <div key={i} className="status-row">
          <span className="status-cell-name">
            {row.name}
            {row.note && (
              <span className="status-cell-note">{row.note}</span>
            )}
          </span>
          {row.state === "ok" ? (
            <span className="status-ok" aria-label="ok">
              ✓
            </span>
          ) : row.state === "fail" ? (
            <span className="status-fail" aria-label="failed">
              ×
            </span>
          ) : (
            <span className="status-pending" aria-label="pending" />
          )}
        </div>
      ))}
    </CollapsibleBlock>
  );
}
