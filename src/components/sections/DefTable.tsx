"use client";

import type { ReactNode } from "react";
import type { SectionAccent, KVRow } from "@/lib/section-parser";
import styles from "./sections.module.css";

interface DefTableProps {
  accent: SectionAccent;
  icon: string;
  title: string;
  rows: KVRow[];
}

/**
 * Pattern A — 2-column definition table.
 * Left col: 38% fixed key (semibold, dim). Right col: value wraps freely.
 * Inline backtick spans render as styled <code>. Never overflows mobile.
 */
export default function DefTable({ accent, icon, title, rows }: DefTableProps) {
  const accentClass =
    accent === "teal"
      ? styles.cardTeal
      : accent === "amber"
        ? styles.cardAmber
        : styles.cardBlue;

  return (
    <div className={`${styles.card} ${accentClass}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderLeft}>
          <span className={styles.cardIcon} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.cardTitle}>{title || "OUTPUT"}</span>
        </div>
        <span className={styles.agentBadge}>WARP•CMD</span>
      </div>

      <div>
        <div className={styles.tblHeader}>
          <span>Field</span>
          <span>Value</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className={styles.defRow}>
            <div className={styles.defKey}>{row.key}</div>
            <div className={styles.defVal}>{renderVal(row.val)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Render a value string with inline backtick spans converted to
 * styled <code> elements (warp-blue, glass tint). Everything else
 * is plain text so XSS is not a concern.
 */
function renderVal(val: string): ReactNode {
  const parts = val.split(/(`[^`\n]+`)/g);
  if (parts.length === 1) return val;
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part || null;
  });
}
