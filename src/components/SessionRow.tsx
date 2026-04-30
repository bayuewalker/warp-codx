"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@/lib/types";
import { relativeTimeId } from "@/lib/relativeTime";
import { cn } from "@/lib/cn";

type Props = {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
};

export default function SessionRow({ session, active, onSelect, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Tick relative time every 30s so "baru saja" / "1m lalu" stay fresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Close menu on outside click / Escape.
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
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2.5 py-2",
        "border-hair",
        active
          ? "bg-white/[0.05] border-warp-blue/40"
          : "border-transparent hover:bg-white/[0.03]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 text-left"
      >
        <div
          className={cn(
            "truncate text-[13px] leading-tight",
            active ? "text-white" : "text-white/85",
          )}
        >
          {session.label}
        </div>
        <div className="mt-1 text-[10px] text-white/35">
          {relativeTimeId(session.updated_at ?? session.created_at)}
        </div>
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
        className={cn(
          "shrink-0 w-7 h-7 -mr-1 rounded-md flex items-center justify-center",
          "text-white/45 hover:text-white hover:bg-white/[0.06]",
          "md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100",
          menuOpen && "opacity-100 text-white bg-white/[0.06]",
        )}
      >
        <span className="text-lg leading-none translate-y-[-1px]">⋮</span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className={cn(
            "absolute right-1 top-[calc(100%+4px)] z-20 w-44",
            "bg-warp-bg border-hair border-warp-border rounded-md",
            "shadow-[0_0_0_0.5px_rgba(255,255,255,0.06)]",
            "py-1 text-[12px]",
          )}
          style={{ background: "#16161a" }}
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
