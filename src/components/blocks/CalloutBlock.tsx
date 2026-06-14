"use client";

import type { CalloutKind, CalloutPayload } from "@/lib/types";

type Props = {
  payload: CalloutPayload;
};

const META: Record<
  CalloutKind,
  { icon: string; label: string }
> = {
  success: { icon: "✓", label: "Success" },
  warning: { icon: "⚠", label: "Warning" },
  error: { icon: "✕", label: "Error" },
  info: { icon: "ℹ", label: "Info" },
};

/**
 * Standardized status callout — SUCCESS / WARNING / ERROR / INFO with
 * consistent icon, accent rail, and tinted surface. Replaces ad-hoc
 * bold-text status lines so every "task completed" / "merge blocked"
 * reads the same across the app.
 */
export default function CalloutBlock({ payload }: Props) {
  const kind: CalloutKind = META[payload.kind] ? payload.kind : "info";
  const meta = META[kind];
  const title = payload.title?.trim() || meta.label;

  return (
    <div className={`callout callout--${kind}`} role="note">
      <span className="callout-icon" aria-hidden="true">
        {meta.icon}
      </span>
      <div className="callout-body">
        <div className="callout-title">{title}</div>
        {payload.text && <div className="callout-text">{payload.text}</div>}
      </div>
    </div>
  );
}
