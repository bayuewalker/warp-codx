"use client";

import { cn } from "@/lib/cn";

/**
 * Compact Chat ⇆ Code surface toggle.
 *
 * Lives in the chat composer toolbar (next to the model picker) and in the
 * workspace header, so the two top-level surfaces are one tap apart from
 * wherever you are. Styled to sit inline with the toolbar controls.
 */
export type AppView = "chat" | "workspace";

export default function ViewToggle({
  view,
  onChange,
  className,
}: {
  view: AppView;
  onChange: (v: AppView) => void;
  className?: string;
}) {
  return (
    <div className={cn("view-toggle", className)} role="tablist" aria-label="Surface">
      <button
        type="button"
        role="tab"
        aria-selected={view === "chat"}
        className="view-toggle-btn"
        data-active={view === "chat"}
        onClick={() => onChange("chat")}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "workspace"}
        className="view-toggle-btn"
        data-active={view === "workspace"}
        onClick={() => onChange("workspace")}
      >
        Code
      </button>
    </div>
  );
}
