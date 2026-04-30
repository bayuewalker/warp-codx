"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, LayoutGrid, Paperclip, Square } from "lucide-react";
import { MODELS, formatModelSlug } from "@/lib/models";

type LedHealth = "online" | "checking" | "error" | "unknown";

type Props = {
  disabled?: boolean;
  isStreaming?: boolean;
  onStopStream?: () => void;
  ledHealth?: LedHealth;
  placeholder?: string;
  onSend: (text: string) => void;
};

// 13px font with 1.5 line-height ≈ 20px per visual line. Allow up to 5 lines
// before the textarea starts scrolling internally.
const LINE_HEIGHT_PX = 20;
const MAX_ROWS = 5;

export default function ChatInput({
  disabled = false,
  isStreaming = false,
  onStopStream,
  ledHealth = "online",
  placeholder = "Describe your task or type / for commands",
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
    const max = LINE_HEIGHT_PX * MAX_ROWS;
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  }, [value]);

  const send = () => {
    const t = value.trim();
    if (!t || disabled || isStreaming) return;
    onSend(t);
    setValue("");
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = "auto";
    });
  };

  const handleSendOrStop = () => {
    if (isStreaming) {
      onStopStream?.();
    } else {
      send();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  // Send button is enabled when:
  //  - streaming AND an abort handler exists AND composer is not disabled
  //    (so the user can stop), OR
  //  - input has content and the composer is not otherwise disabled.
  // `disabled` (e.g. no active session) is always absolute.
  const sendBtnDisabled = isStreaming
    ? !onStopStream || disabled
    : !value.trim() || disabled;

  // Textarea is disabled while streaming or when the parent says so
  // (e.g., no active session).
  const taDisabled = disabled || isStreaming;

  return (
    <div className="input-zone-wrap warp-sans">
      <div
        className="input-zone"
        data-focused={focused ? "true" : "false"}
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
          disabled={taDisabled}
          spellCheck={false}
          autoComplete="off"
          aria-label="Directive input"
          className="input-field warp-sans"
        />
        <div className="input-toolbar">
          {/* Paperclip — disabled placeholder for future file attach */}
          <button
            type="button"
            className="input-tool-btn"
            title="Attach (coming soon)"
            disabled
            aria-label="Attach file"
          >
            <Paperclip size={14} strokeWidth={2} />
          </button>

          {/* Grid — disabled placeholder for future quick actions */}
          <button
            type="button"
            className="input-tool-btn"
            title="Quick actions (coming soon)"
            disabled
            aria-label="Quick actions"
          >
            <LayoutGrid size={14} strokeWidth={2} />
          </button>

          <span className="input-toolbar-spacer" aria-hidden="true" />

          {/* Send / stop morph — same DOM node, icon swaps based on state. */}
          <button
            type="button"
            className="input-send-btn"
            data-state={isStreaming ? "streaming" : "idle"}
            onClick={handleSendOrStop}
            disabled={sendBtnDisabled}
            title={isStreaming ? "Stop" : "Send"}
            aria-label={isStreaming ? "Stop generation" : "Send"}
          >
            {isStreaming ? (
              <Square size={12} strokeWidth={0} fill="currentColor" />
            ) : (
              <ArrowUp size={14} strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      {/* Footer — LED + model name only. No state text, no stop button. */}
      <div className="input-footer">
        <span
          className="footer-led"
          data-health={ledHealth}
          title={`${MODELS.cmd} — ${ledHealth}`}
          aria-label={`Model status: ${ledHealth}`}
        />
        <span className="footer-model">{formatModelSlug(MODELS.cmd)}</span>
      </div>
    </div>
  );
}
