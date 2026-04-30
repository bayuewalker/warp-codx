"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MODELS, formatModelSlug } from "@/lib/models";

type Props = {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
};

// 13px font with 1.5 line-height ≈ 20px per visual line. Allow up to 5 lines
// before the textarea starts scrolling internally.
const LINE_HEIGHT_PX = 20;
const MAX_ROWS = 5;
const VERTICAL_PADDING_PX = 0; // textarea has no extra padding; container pads.

export default function ChatInput({
  disabled = false,
  placeholder = "Send a directive",
  onSend,
}: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to MAX_ROWS rows.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = LINE_HEIGHT_PX * MAX_ROWS + VERTICAL_PADDING_PX;
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  }, [value]);

  const send = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = "auto";
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;
  const maxHeight = LINE_HEIGHT_PX * MAX_ROWS + VERTICAL_PADDING_PX;

  return (
    <div
      className="warp-sans"
      style={{
        padding: "10px 14px",
        border: `1px solid rgba(255,255,255,${focused ? 0.2 : 0.1})`,
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        transition: "border-color 120ms ease-out",
      }}
    >
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-label="Directive input"
        className="warp-sans warp-input-textarea block w-full min-w-0 resize-none bg-transparent border-0 outline-none disabled:opacity-50"
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(255,255,255,0.95)",
          maxHeight,
          padding: 0,
          margin: 0,
        }}
      />
      <div
        className="input-meta warp-sans"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingTop: 6,
        }}
      >
        <span
          className="input-model"
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.40)",
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}
        >
          WARP🔹CMD · {formatModelSlug(MODELS.cmd)}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Send directive"
          className="input-send"
        >
          {/* Inline ArrowUp — same visual as lucide-react ArrowUp at
              size=16, strokeWidth=2. Inline SVG keeps Phase 1.5d's
              "no new packages beyond geist" constraint. */}
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
