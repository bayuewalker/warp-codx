"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@/lib/types";
import { relativeTimeId } from "@/lib/relativeTime";

type Props = {
  session: Session;
  active: boolean;
  /** Optional unread count rendered as a purple badge on the right. */
  unread?: number;
  onSelect: () => void;
  onDelete: () => void;
};

export default function SessionRow({
  session,
  active,
  unread,
  onSelect,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div
      ref={wrapRef}
      className="group relative"
    >
      <button
        type="button"
        onClick={onSelect}
        className={`session-row ${active ? "active" : ""}`}
      >
        <span className="session-status-dot" aria-hidden="true" />
        <div className="session-row-content">
          <div className="session-row-title">{session.label}</div>
          <div className="session-row-meta">
            {relativeTimeId(session.updated_at ?? session.created_at)}
          </div>
        </div>
        {typeof unread === "number" && unread > 0 && (
          <span className="session-badge" aria-label={`${unread} unread`}>
            {unread}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label="Session options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
          setConfirming(false);
        }}
        className={`absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md
          flex items-center justify-center text-white/45 hover:text-white
          hover:bg-white/[0.06]
          md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100
          ${menuOpen ? "opacity-100 text-white bg-white/[0.06]" : ""}`}
      >
        <span className="text-lg leading-none translate-y-[-1px]">⋮</span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-1 top-[calc(100%+4px)] z-20 w-44
            bg-warp-bg-2 border-hair border-warp-border rounded-md
            shadow-[0_0_0_0.5px_rgba(255,255,255,0.06)]
            py-1 text-[12px]"
        >
          {!confirming ? (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              className="w-full text-left px-3 py-1.5 text-white/85 hover:bg-white/[0.06]"
            >
              Delete session
            </button>
          ) : (
            <div className="px-3 py-2 flex flex-col gap-2">
              <div className="text-white/65 text-[11px] leading-snug">
                Delete this session and all messages?
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setConfirming(false);
                  }}
                  className="px-2 py-1 text-white/55 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setConfirming(false);
                    onDelete();
                  }}
                  className="px-2 py-1 text-warp-amber hover:text-white hover:bg-warp-amber/30 rounded"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
