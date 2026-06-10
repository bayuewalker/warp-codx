"use client";

/**
 * Composer model picker (Ona-style).
 *
 * A compact button showing the current choice; tapping it opens a small menu of
 * models. "Auto" routes per message (Sonnet for coding, GPT-4o for chat); an
 * explicit pick pins that model. The selection is shared app-wide via
 * `useSelectedModel` (localStorage + window event), so the status strip stays
 * in sync. The picker is purely a control — the server still decides the real
 * model and the strip reflects it.
 */
import { useEffect, useRef, useState } from "react";
import { SELECTABLE_MODELS } from "@/lib/models";
import { useSelectedModel } from "@/lib/selected-model";

export default function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const [selected, setSelected] = useSelectedModel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const current =
    SELECTABLE_MODELS.find((m) => m.id === selected) ?? SELECTABLE_MODELS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="model-picker-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Model: ${current.label} — ${current.hint}`}
      >
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
        <span className="model-picker-label">{current.short}</span>
        <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="model-picker-menu" role="listbox">
          <div className="model-picker-heading">Model</div>
          {SELECTABLE_MODELS.map((m) => {
            const active = m.id === selected;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`model-picker-item${active ? " is-active" : ""}`}
                onClick={() => {
                  setSelected(m.id);
                  setOpen(false);
                }}
              >
                <span className="model-picker-item-main">
                  <span className="model-picker-item-name">{m.label}</span>
                  <span className="model-picker-item-hint">{m.hint}</span>
                </span>
                {active && (
                  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
