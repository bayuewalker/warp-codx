"use client";

import { useId, type ReactNode } from "react";

type Props = {
  /** Outer wrapper class (per-block flavor, e.g. "diff-block"). */
  className: string;
  /** Class applied to the header <button>. Defaults to "block-summary". */
  headerClassName?: string;
  /** Header content rendered to the left of the count pill / toggle. */
  header: ReactNode;
  /** Optional small count pill (e.g. "+3 −15", "3/8", "5 rows"). */
  pill?: ReactNode;
  /** Current expanded state. */
  expanded: boolean;
  /** Toggle handler — invoked from header button and footer "Show N more". */
  onToggle: () => void;
  /** Body, hidden / partially-visible based on `expanded`. */
  children: ReactNode;
  /**
   * If set, the body is always rendered and the footer "Show N more ▾" /
   * "Show less ▴" row is rendered below it. Used for partial-collapse cases
   * (Todo / Status) where the first few items remain visible. When omitted,
   * the body is unmounted entirely while collapsed.
   */
  partialFooterLabel?: string;
};

export default function CollapsibleBlock({
  className,
  headerClassName = "block-summary",
  header,
  pill,
  expanded,
  onToggle,
  children,
  partialFooterLabel,
}: Props) {
  const bodyId = useId();
  const isPartial = partialFooterLabel !== undefined;
  const headerLabel = expanded
    ? "Show less"
    : isPartial
      ? partialFooterLabel
      : "Show full";

  return (
    <div className={className}>
      <button
        type="button"
        className={headerClassName}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        {header}
        {pill !== undefined && pill !== null && (
          <span className="block-pill">{pill}</span>
        )}
        <span className="block-toggle">
          <span className="block-toggle-label">{headerLabel}</span>
          <span
            className={`block-chev${expanded ? " open" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </span>
      </button>
      {(expanded || isPartial) && (
        <div id={bodyId} role="region" className="block-body">
          {children}
          {isPartial && (
            <button
              type="button"
              className="block-footer-toggle"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={bodyId}
            >
              <span>{expanded ? "Show less" : partialFooterLabel}</span>
              <span
                className={`block-chev${expanded ? " open" : ""}`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
