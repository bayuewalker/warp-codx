"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MODELS, formatModelSlug } from "@/lib/models";

type LedHealth = "online" | "checking" | "error" | "unknown";

type Props = {
  disabled?: boolean;
  isStreaming?: boolean;
  onStopStream?: () => void;
  ledHealth?: LedHealth;
  placeholder?: string;
  onSend: (text: string) => void;
  /**
   * Optional slash-command interceptor. Invoked before `onSend` for
   * any input starting with "/". Return `true` to indicate the
   * command was handled (input is cleared and `onSend` is skipped);
   * return `false` to fall through to the normal chat path.
   */
  onSlashCommand?: (raw: string) => Promise<boolean> | boolean;
};

const MAX_HEIGHT_PX = 144;

export default function ChatInput({
  disabled = false,
  isStreaming = false,
  onStopStream,
  ledHealth = "online",
  placeholder = "Describe your task or type / for commands",
  onSend,
  onSlashCommand,
}: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, MAX_HEIGHT_PX) + "px";
  }, [value]);

  const resetField = () => {
    setValue("");
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = "auto";
    });
  };

  const send = async () => {
    const t = value.trim();
    if (!t || disabled || isStreaming) return;

    // Slash-command branch. Delegate to the parent (ChatArea owns the
    // admin-authenticated refresh path and the in-transcript echo).
    // If the parent indicates the command was handled, swallow the
    // input; otherwise fall through to the normal chat dispatch.
    if (t.startsWith("/") && onSlashCommand) {
      const handled = await onSlashCommand(t);
      if (handled) {
        resetField();
        return;
      }
    }

    onSend(t);
    resetField();
  };

  const handleSendOrStop = () => {
    if (isStreaming) {
      onStopStream?.();
    } else {
      void send();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const sendBtnDisabled = isStreaming
    ? !onStopStream || disabled
    : !value.trim() || disabled;

  const taDisabled = disabled || isStreaming;

  return (
    <div className="input-zone-wrap">
      <div className="input-zone" data-focused={focused ? "true" : "false"}>
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
          className="input-field"
        />
        <div className="input-toolbar">
          <button
            type="button"
            className="input-tool-btn"
            title="Attach"
            aria-label="Attach file"
            disabled
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
              width={14}
              height={14}
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <button
            type="button"
            className="input-tool-btn"
            title="Templates"
            aria-label="Templates"
            disabled
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
              width={14}
              height={14}
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>

          <span className="input-toolbar-spacer" aria-hidden="true" />

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
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                width={12}
                height={12}
              >
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                width={14}
                height={14}
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>

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
