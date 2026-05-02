"use client";

/**
 * Reusable empty-state for drawer panels (PR list, Issues list,
 * Sessions list) and the chat surface (Home / no-session, no-messages).
 *
 * Variants:
 *   - `eyebrow`  : optional small uppercase label above the title
 *                  (used by the Home/WARP CodX welcome).
 *   - `icon`     : optional 32px glyph or inline SVG, rendered centered
 *                  at 60% opacity above the title.
 *   - `title`    : 15px / 600. Required.
 *   - `subtitle` : 13px muted, max-w-[240px]. Optional.
 *   - `action`   : optional outline button. Min-h 40px to satisfy
 *                  mobile touch-target guidelines.
 *
 * Layout is always a vertical-centered column inside the parent.
 * The component is height-flexible: parents can mount it inside a
 * `flex-1` container and it will fill and center; or inside a fixed
 * panel and it will simply pad itself.
 */

import { cn } from "@/lib/cn";

type Action = {
  label: string;
  onClick: () => void;
};

type Props = {
  icon?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: Action;
  className?: string;
};

export default function EmptyState({
  icon,
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "h-full w-full flex items-center justify-center text-center px-6 py-10",
        className,
      )}
    >
      <div className="flex flex-col items-center max-w-[280px]">
        {icon && (
          <div
            aria-hidden="true"
            className="mb-3 flex items-center justify-center text-white/60"
            style={{ width: 32, height: 32, fontSize: 28, lineHeight: 1 }}
          >
            {icon}
          </div>
        )}
        {eyebrow && (
          <div className="text-warp-blue text-[11px] uppercase tracking-[0.18em] mb-2">
            {eyebrow}
          </div>
        )}
        <h2 className="text-[15px] font-semibold text-white/90 leading-snug">
          {title}
        </h2>
        {subtitle && (
          <div className="mt-2 text-[13px] text-white/55 leading-relaxed max-w-[240px]">
            {subtitle}
          </div>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-4 inline-flex items-center justify-center gap-2 px-4 min-h-[40px] rounded-md border border-warp-blue/40 bg-warp-blue/10 hover:bg-warp-blue/20 active:bg-warp-blue/30 text-warp-blue text-[13px] font-medium transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
