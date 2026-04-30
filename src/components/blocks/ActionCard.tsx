"use client";

import { useState } from "react";
import type { ActionPayload } from "@/lib/types";

type Props = {
  payload: ActionPayload;
};

export default function ActionCard({ payload }: Props) {
  const [open, setOpen] = useState(payload.defaultOpen ?? true);

  // Render the summary with the optional path swapped in as a styled
  // mono span. The agent can either embed `{path}` inside the summary
  // string (for inline placement) or pass a bare summary + a separate
  // path that we'll render after the summary text.
  const summaryNodes = renderWithPath(payload.summary, payload.path);
  const detailNodes = payload.detail
    ? renderWithPath(payload.detail, payload.path)
    : null;

  const outputString =
    payload.output !== undefined
      ? typeof payload.output === "string"
        ? payload.output
        : JSON.stringify(payload.output)
      : null;

  return (
    <div className="action-card">
      <button
        type="button"
        className="action-card-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`action-chev${open ? " open" : ""}`}>›</span>
        <span className="action-summary-text">{summaryNodes}</span>
      </button>
      {open && (
        <div className="action-card-body">
          <div className="action-detail-card">
            {(detailNodes || payload.path) && (
              <div className="action-detail-header">
                <span className="action-detail-icon" aria-hidden="true">
                  ‹›
                </span>
                <span className="action-detail-text">
                  {detailNodes ?? (
                    <>
                      <span className="path-mono">{payload.path}</span>
                    </>
                  )}
                </span>
              </div>
            )}
            {outputString !== null && (
              <div className="action-output">{outputString}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Replace the literal `{path}` token with a styled mono span. If no
 *  `{path}` placeholder is found, the text is returned unchanged and the
 *  caller can choose to render the path in a separate slot. */
function renderWithPath(text: string, path?: string): React.ReactNode {
  if (!path || !text.includes("{path}")) return text;
  const parts = text.split("{path}");
  const out: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    out.push(<span key={`t${i}`}>{p}</span>);
    if (i < parts.length - 1) {
      out.push(
        <span key={`p${i}`} className="path-mono">
          {path}
        </span>,
      );
    }
  });
  return out;
}
