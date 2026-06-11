"use client";

import type { StatusRow } from "@/lib/section-parser";
import styles from "./sections.module.css";

interface StatusTableProps {
  icon: string;
  title: string;
  rows: StatusRow[];
  /** Active model label shown top-right (falls back to "WARP•CMD"). */
  badge?: string;
}

/**
 * Pattern B — Status table (File | Last Signal).
 * File column: 44% fixed, font-mono, warp-blue, break-all.
 * Signal column: flex-1, wraps, auto-badge on COMPLETE/PENDING/ERROR keywords.
 */
export default function SectionsStatusTable({
  icon,
  title,
  rows,
  badge,
}: StatusTableProps) {
  return (
    <div className={`${styles.card} ${styles.cardBlue}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderLeft}>
          <span className={styles.cardIcon} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.cardTitle}>{title || "STATUS"}</span>
        </div>
        <span className={styles.agentBadge}>{badge || "WARP•CMD"}</span>
      </div>

      <div>
        <div className={styles.statusHeader}>
          <span>File / Branch</span>
          <span>Last Signal</span>
        </div>
        {rows.map((row, i) => {
          const sigBadge = detectBadge(row.signal);
          // Strip badge keyword from signal text to avoid duplication
          const signalText = sigBadge
            ? row.signal
                .replace(
                  /\b(COMPLETE|DONE|PENDING|NOT READ|ERROR|FAILED?|FAIL)\b/gi,
                  "",
                )
                .trim()
                .replace(/\s{2,}/g, " ")
            : row.signal;

          return (
            <div key={i} className={styles.statusRow}>
              <div className={styles.statusFile}>{row.file}</div>
              <div className={styles.statusSignal}>
                {signalText}
                {sigBadge && (
                  <span
                    className={
                      sigBadge.kind === "green"
                        ? styles.badgeGreen
                        : sigBadge.kind === "red"
                          ? styles.badgeRed
                          : styles.badgeMuted
                    }
                  >
                    {sigBadge.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function detectBadge(
  text: string,
): { kind: "green" | "muted" | "red"; label: string } | null {
  const u = text.toUpperCase();
  if (/\b(ERROR|FAILED?|FAIL)\b/.test(u)) return { kind: "red", label: "ERROR" };
  if (/\bPENDING\b/.test(u) || /\bNOT READ\b/i.test(text))
    return { kind: "muted", label: "PENDING" };
  if (/\b(COMPLETE|DONE)\b/.test(u)) return { kind: "green", label: "COMPLETE" };
  return null;
}
