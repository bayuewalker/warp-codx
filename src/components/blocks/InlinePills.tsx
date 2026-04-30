"use client";

import { Fragment, type ReactNode } from "react";

export function renderInlinePills(text: string): ReactNode {
  if (!text) return text;

  const RE =
    /(WARP[\u2022\u{1F539}](?:CMD|FORGE|SENTINEL|ECHO))|(WARP\/[A-Za-z0-9._\-/]+)/gu;

  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = RE.exec(text)) !== null) {
    const [whole, agentTok, branchTok] = match;
    const start = match.index;
    if (start > lastIndex) {
      out.push(<Fragment key={`t${key++}`}>{text.slice(lastIndex, start)}</Fragment>);
    }

    if (agentTok) {
      const kind = agentTok.replace(/^WARP[\u2022\u{1F539}]/u, "").toLowerCase();
      const cls =
        kind === "cmd" || kind === "forge" || kind === "sentinel" || kind === "echo"
          ? kind
          : "echo";
      out.push(
        <span key={`a${key++}`} className={`agent-pill ${cls}`}>
          {agentTok}
        </span>,
      );
    } else if (branchTok) {
      out.push(
        <span key={`b${key++}`} className="branch-badge">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="18" r="3" />
            <path d="M6 9v3a3 3 0 0 0 3 3h6" />
          </svg>
          {branchTok}
        </span>,
      );
    } else {
      out.push(<Fragment key={`x${key++}`}>{whole}</Fragment>);
    }

    lastIndex = start + whole.length;
  }

  if (lastIndex < text.length) {
    out.push(<Fragment key={`t${key++}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return out.length === 1 ? out[0] : <>{out}</>;
}

export function withInlinePills(children: ReactNode): ReactNode {
  if (children == null) return children;
  if (typeof children === "string") return renderInlinePills(children);
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string" ? (
        <Fragment key={`s${i}`}>{renderInlinePills(c)}</Fragment>
      ) : (
        <Fragment key={`e${i}`}>{c}</Fragment>
      ),
    );
  }
  return children;
}
