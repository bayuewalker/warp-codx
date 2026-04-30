"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

type Props = {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
};

const LINE_HEIGHT_PX = 20; // matches text-[13px] / leading-relaxed roughly
const MAX_ROWS = 6;

export default function ChatInput({
  disabled = false,
  placeholder = "Type a message…",
  onSend,
}: Props) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow up to MAX_ROWS rows
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = LINE_HEIGHT_PX * MAX_ROWS + 16;
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

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-lg border-hair border-warp-border",
        "bg-white/[0.025] px-2.5 py-2",
        "focus-within:border-warp-blue/45",
      )}
    >
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "flex-1 min-w-0 resize-none bg-transparent outline-none",
          "text-[13px] leading-relaxed text-white placeholder:text-white/30",
          "py-1 px-1",
          "disabled:opacity-50",
        )}
        style={{ maxHeight: LINE_HEIGHT_PX * MAX_ROWS + 16 }}
      />
      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        aria-label="Send"
        className={cn(
          "shrink-0 h-9 px-3 rounded-md text-[12px] font-medium",
          "transition-colors flex items-center gap-1.5",
          canSend
            ? "bg-warp-blue text-black hover:bg-warp-blue/90 active:bg-warp-blue/80"
            : "bg-white/[0.06] text-white/30",
        )}
      >
        <span>Send</span>
        <span aria-hidden className="text-base leading-none">↵</span>
      </button>
    </div>
  );
}
