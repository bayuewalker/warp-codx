"use client";

import type { StatusPayload } from "@/lib/types";

type Props = {
  payload: StatusPayload;
};

export default function StatusTable({ payload }: Props) {
  const nameHeader = payload.nameHeader ?? "Component";
  const statusHeader = payload.statusHeader ?? "Status";

  return (
    <div className="status-table">
      <div className="status-row header">
        <span>{nameHeader}</span>
        <span>{statusHeader}</span>
      </div>
      {payload.rows.map((row, i) => (
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
    </div>
  );
}
