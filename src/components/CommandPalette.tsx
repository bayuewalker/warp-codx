"use client";

/**
 * ⌘K / Ctrl+K command palette — the universal Replit-style quick-switcher.
 *
 * Opens on ⌘K (Mac) or Ctrl+K (Win/Linux), or when any caller dispatches
 * `window.dispatchEvent(new CustomEvent("warp:open-palette"))`. Lists three
 * sections — Actions, Sessions, Switch model — with fuzzy filter, ↑↓
 * keyboard navigation, Enter to invoke, Esc to close. Mounted via portal
 * with the same animation contract as `ShortcutSheet` so it feels at home
 * next to existing sheets.
 *
 * Sessions are passed in (parent owns the list); model + selection comes
 * from `useSelectedModel`. The palette never reaches for state of its
 * own — it dispatches back through props + window events that ChatArea
 * already listens to (`warp:new-directive`).
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Session } from "@/lib/types";
import { SELECTABLE_MODELS, type SelectableModelId } from "@/lib/models";
import { useSelectedModel } from "@/lib/selected-model";

export const OPEN_PALETTE_EVENT = "warp:open-palette";

export type PaletteAction =
  | { kind: "new-directive" }
  | { kind: "open-session"; sessionId: string }
  | { kind: "open-settings" }
  | { kind: "refresh-constitution" }
  | { kind: "sign-out" }
  | { kind: "select-model"; modelId: SelectableModelId };

type PaletteItem = {
  id: string;
  /** Group label shown above the first item in that group. */
  group: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  hint?: string;
  /** Lower-cased text the fuzzy matcher walks. */
  searchHay: string;
  action: PaletteAction;
};

type Props = {
  sessions: Session[];
  activeSessionId: string | null;
  onAction: (action: PaletteAction) => void;
  /** Open via uplifted prop (e.g. a header button); the ⌘K shortcut is wired internally. */
  open?: boolean;
  onClose?: () => void;
};

/** Cheap subsequence fuzzy filter — every char of query must appear in order. */
function fuzzyMatch(hay: string, query: string): boolean {
  if (!query) return true;
  const h = hay;
  const q = query;
  let i = 0;
  for (let j = 0; j < h.length && i < q.length; j += 1) {
    if (h[j] === q[i]) i += 1;
  }
  return i === q.length;
}

export default function CommandPalette({
  sessions,
  activeSessionId,
  onAction,
  open: openProp,
  onClose,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  // Mount/visibility transition states — same pattern as ShortcutSheet.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [modelId] = useSelectedModel();

  const isControlled = typeof openProp === "boolean";
  const open = isControlled ? openProp : internalOpen;

  const close = useCallback(() => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
  }, [isControlled, onClose]);

  // Global ⌘K / Ctrl+K — works from anywhere in the app, including from
  // inside other modals (close them first if needed).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        if (isControlled) {
          // The parent owns open state — fire the event so anyone listening
          // (typically the parent itself via OPEN_PALETTE_EVENT) can flip it.
          window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
        } else {
          setInternalOpen((v) => !v);
        }
      }
    }
    function onOpenEvent() {
      if (isControlled) return; // parent handles
      setInternalOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    };
  }, [isControlled]);

  // Mount/animate-in/-out — matches ShortcutSheet so both feel native side by side.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => {
        setVisible(true);
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    if (mounted) {
      setVisible(false);
      setQuery("");
      setActiveIndex(0);
      const id = window.setTimeout(() => setMounted(false), 180);
      return () => window.clearTimeout(id);
    }
  }, [open, mounted]);

  // Esc + body scroll lock while the palette is mounted.
  useEffect(() => {
    if (!mounted) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, close]);

  // ─── Build the flat item list. Sessions and model rows are dynamic. ───
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];

    out.push(
      {
        id: "action:new",
        group: "Actions",
        icon: <Icon name="plus" />,
        title: "New directive",
        subtitle: "Start a fresh chat session",
        hint: "⌘N",
        searchHay: "new directive chat session start fresh",
        action: { kind: "new-directive" },
      },
      {
        id: "action:refresh-constitution",
        group: "Actions",
        icon: <Icon name="refresh" />,
        title: "Refresh constitution",
        subtitle: "Re-fetch AGENTS / COMMANDER / state from GitHub",
        searchHay: "refresh constitution sync github pull update",
        action: { kind: "refresh-constitution" },
      },
      {
        id: "action:settings",
        group: "Actions",
        icon: <Icon name="cog" />,
        title: "Open settings",
        subtitle: "Provider keys, memory, skills, display",
        hint: "⌘,",
        searchHay: "settings preferences provider keys memory skills",
        action: { kind: "open-settings" },
      },
      {
        id: "action:sign-out",
        group: "Actions",
        icon: <Icon name="exit" />,
        title: "Sign out",
        searchHay: "sign out logout exit",
        action: { kind: "sign-out" },
      },
    );

    // Recent sessions (cap at 12 so the palette stays scannable; fuzzy filter
    // covers the rest).
    for (const s of sessions.slice(0, 12)) {
      const isActive = s.id === activeSessionId;
      out.push({
        id: `session:${s.id}`,
        group: "Sessions",
        icon: <Icon name="chat" />,
        title: s.label || "(untitled session)",
        subtitle: isActive ? "Current session" : undefined,
        searchHay: `session ${s.label ?? ""}`.toLowerCase(),
        action: { kind: "open-session", sessionId: s.id },
      });
    }

    // Model switcher — flag the current selection so the user sees what's
    // active without leaving the palette.
    for (const m of SELECTABLE_MODELS) {
      const isActive = m.id === modelId;
      out.push({
        id: `model:${m.id}`,
        group: "Switch model",
        icon: <Icon name="model" />,
        title: m.label,
        subtitle: isActive ? "Current model" : m.hint,
        searchHay: `model ${m.label} ${m.short} ${m.hint}`.toLowerCase(),
        action: { kind: "select-model", modelId: m.id },
      });
    }

    return out;
  }, [sessions, activeSessionId, modelId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => fuzzyMatch(it.searchHay, q));
  }, [items, query]);

  // Reset selection to the first matching row whenever the filtered set
  // changes (typing a new char shouldn't leave the highlight on a now-
  // gone row).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the active row in view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const fire = useCallback(
    (item: PaletteItem) => {
      close();
      onAction(item.action);
    },
    [close, onAction],
  );

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[activeIndex];
        if (item) fire(item);
      }
    },
    [filtered, activeIndex, fire],
  );

  if (!mounted || typeof document === "undefined") return null;
  const state = visible ? "open" : "closed";

  // Track the group boundary so we render a heading once per group.
  let lastGroup: string | null = null;

  return createPortal(
    <div
      className="warp-palette-root"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="warp-palette-backdrop"
        data-state={state}
        onClick={close}
        aria-hidden="true"
      />
      <div className="warp-palette" data-state={state}>
        <div className="warp-palette-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Type a command, search sessions, switch model…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            spellCheck={false}
            autoComplete="off"
            aria-label="Command palette search"
            aria-autocomplete="list"
            aria-controls="warp-palette-list"
            aria-activedescendant={
              filtered[activeIndex]
                ? `warp-palette-item-${activeIndex}`
                : undefined
            }
          />
          <kbd className="warp-palette-esc">esc</kbd>
        </div>

        <ul
          ref={listRef}
          id="warp-palette-list"
          role="listbox"
          className="warp-palette-list"
        >
          {filtered.length === 0 ? (
            <li className="warp-palette-empty">No matching command.</li>
          ) : (
            filtered.map((item, i) => {
              const newGroup = item.group !== lastGroup;
              lastGroup = item.group;
              const active = i === activeIndex;
              return (
                <li key={item.id} className="warp-palette-row-li">
                  {newGroup && (
                    <div className="warp-palette-group">{item.group}</div>
                  )}
                  <button
                    type="button"
                    id={`warp-palette-item-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={active}
                    className="warp-palette-row"
                    data-active={active ? "true" : "false"}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => fire(item)}
                  >
                    <span className="warp-palette-row-icon">{item.icon}</span>
                    <span className="warp-palette-row-text">
                      <span className="warp-palette-row-title">
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="warp-palette-row-sub">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {item.hint && (
                      <kbd className="warp-palette-row-hint">{item.hint}</kbd>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="warp-palette-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Minimal SVG icon set — palette-only so we don't pull in lucide for one screen.
 * `currentColor` so they pick up the row text color (active rows go WARP blue).
 */
function Icon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "plus":
      return (
        <svg {...common}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
          <path d="M20.49 15A9 9 0 015.64 18.36L1 14" />
        </svg>
      );
    case "cog":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    case "exit":
      return (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      );
    case "model":
      return (
        <svg {...common}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case "search":
    default:
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
  }
}
