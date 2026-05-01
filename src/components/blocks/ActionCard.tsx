"use client";

import { useState } from "react";
import type { ActionPayload } from "@/lib/types";
import CollapsibleBlock from "./CollapsibleBlock";

type Props = {
  payload: ActionPayload;
};

export default function ActionCard({ payload }: Props) {
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

  const hasBody = Boolean(detailNodes || payload.path || outputString !== null);
  const outputIsMultiline =
    outputString !== null && outputString.includes("\n");

  // Heuristic: collapse only when the body would actually take meaningful
  // vertical space — i.e. multi-line output. Single-line / no-body actions
  // open by default.
  const defaultExpanded =
    payload.defaultOpen ?? (hasBody ? !outputIsMultiline : true);

  const [expanded, setExpanded] = useState(defaultExpanded);

  const header = (
    <>
      <span className="action-icon" aria-hidden="true">
        ‹›
      </span>
      <span className="action-summary-text">{summaryNodes}</span>
    </>
  );

  if (!hasBody) {
    // Nothing to collapse — render a static (non-button) header card.
    return (
      <div className="action-card">
        <div className="block-summary block-summary--static">{header}</div>
      </div>
    );
  }

  return (
    <CollapsibleBlock
      className="action-card"
      header={header}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="action-card-body">
        <div className="action-detail-card">
          {(detailNodes || payload.path) && (
            <div className="action-detail-header">
              <span className="action-detail-icon" aria-hidden="true">
                ‹›
              </span>
              <span className="action-detail-text">
                {detailNodes ?? (
                  <span className="path-mono">{payload.path}</span>
                )}
              </span>
            </div>
          )}
          {outputString !== null && (
            <div className="action-output">{outputString}</div>
          )}
        </div>
      </div>
    </CollapsibleBlock>
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
