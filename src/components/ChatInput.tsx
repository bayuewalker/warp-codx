"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { MODELS, formatModelSlug } from "@/lib/models";
import ShortcutSheet from "./ShortcutSheet";

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
  /**
   * WARP/input-shortcuts — fire a quick-command as the next user
   * turn. ChatArea wires this to its own `handleSend`. If omitted
   * the shortcut sheet's three text shortcuts are no-ops (the grid
   * icon stays disabled too).
   */
  onShortcutSend?: (text: string) => void;
  /** Mirrors the `+` header button — open a brand-new session. */
  onNewDirective?: () => void;
};

const MAX_HEIGHT_PX = 144;

/**
 * Cap on attachable file size. Larger files would either bloat the
 * chat-completion payload (text-mode fallback inlines text-file
 * contents) or be silently truncated by the model. 5 MB matches the
 * default OpenRouter request body limit and keeps the UX honest.
 */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const ACCEPT_ATTRIBUTE = "image/*,.pdf,.txt,.md";

type Attachment = {
  name: string;
  size: number;
  mime: string;
  /** Inlined text content for `.txt` / `.md` files only. */
  text: string | null;
};

export default function ChatInput({
  disabled = false,
  isStreaming = false,
  onStopStream,
  ledHealth = "online",
  placeholder = "Describe your task or type / for commands",
  onSend,
  onSlashCommand,
  onShortcutSend,
  onNewDirective,
}: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const clearAttachment = () => {
    setAttachment(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /**
   * Build the outgoing message body from the typed input + the
   * staged attachment. Per spec: when the model can't accept the
   * file as multimodal (current text-only chat route), append a
   * marker so CMD knows what was attached. For `.txt`/`.md` we go
   * one step further and inline the file contents inside a fenced
   * code block so CMD can actually act on the text without a
   * round-trip — this keeps the chat route untouched while still
   * making attachments useful.
   */
  const composeOutgoing = (text: string, file: Attachment | null): string => {
    if (!file) return text;
    const sizeKb = (file.size / 1024).toFixed(1);
    if (file.text !== null) {
      const fence = "```";
      // Strip a trailing newline so the closing fence sits on its
      // own line, no matter how the file was encoded.
      const body = file.text.replace(/\n$/, "");
      const block = `${fence}\n${body}\n${fence}`;
      return text
        ? `${text}\n\n[file: ${file.name} (${sizeKb} KB)]\n${block}`
        : `[file: ${file.name} (${sizeKb} KB)]\n${block}`;
    }
    const marker = `[file attached: ${file.name} (${sizeKb} KB)]`;
    return text ? `${text}\n\n${marker}` : marker;
  };

  const send = async () => {
    const t = value.trim();
    // An attachment alone is enough — operator may want to send
    // just the file with no extra prose.
    if (!t && !attachment) return;
    if (disabled || isStreaming) return;

    if (t.startsWith("/") && onSlashCommand) {
      const handled = await onSlashCommand(t);
      if (handled) {
        resetField();
        clearAttachment();
        return;
      }
    }

    onSend(composeOutgoing(t, attachment));
    resetField();
    clearAttachment();
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

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachError(null);

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(
        `File too large — ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds 5 MB limit.`,
      );
      // Drop any previously-staged attachment so the operator can't
      // accidentally send the old file under the assumption that the
      // failed pick replaced it.
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const lowerName = file.name.toLowerCase();
    const isTextLike =
      file.type === "text/plain" ||
      file.type === "text/markdown" ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md");

    if (isTextLike) {
      // Inline the text so CMD can act on it without a multimodal
      // round-trip. FileReader keeps this fully client-side.
      const reader = new FileReader();
      reader.onload = () => {
        const text =
          typeof reader.result === "string" ? reader.result : null;
        setAttachment({
          name: file.name,
          size: file.size,
          mime: file.type || (lowerName.endsWith(".md")
            ? "text/markdown"
            : "text/plain"),
          text,
        });
      };
      reader.onerror = () => {
        setAttachError("Could not read file.");
        // Same reasoning as the size-cap branch above: a failed read
        // must not leave a stale attachment staged.
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.readAsText(file);
    } else {
      // Image / PDF — keep metadata only. The current text-only
      // chat route can't consume raw bytes; the marker lets CMD
      // acknowledge the attachment and ask follow-up questions.
      setAttachment({
        name: file.name,
        size: file.size,
        mime: file.type,
        text: null,
      });
    }
  };

  const onShortcutSendInternal = (text: string) => {
    if (!onShortcutSend || disabled || isStreaming) return;
    onShortcutSend(text);
  };

  const onNewDirectiveInternal = () => {
    if (!onNewDirective) return;
    resetField();
    clearAttachment();
    onNewDirective();
  };

  const sendBtnDisabled = isStreaming
    ? !onStopStream || disabled
    : (!value.trim() && !attachment) || disabled;

  const taDisabled = disabled || isStreaming;
  const toolBtnDisabled = disabled || isStreaming;

  return (
    <div className="input-zone-wrap">
      {/* Attachment pill — sits ABOVE the input zone so the picked
          file is obvious at a glance and the × tap target is well
          clear of the textarea. Tappable area is 32px high (icon
          chip is 18px; pill padding gives the rest). */}
      {attachment && (
        <div className="input-attachment-pill" data-test="attachment-pill">
          <span className="input-attachment-icon" aria-hidden="true">
            {/* Paperclip glyph — matches the toolbar icon. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              width={12}
              height={12}
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </span>
          <span className="input-attachment-name" title={attachment.name}>
            {attachment.name}
          </span>
          <span className="input-attachment-size">
            {(attachment.size / 1024).toFixed(1)} KB
          </span>
          <button
            type="button"
            className="input-attachment-clear"
            onClick={clearAttachment}
            aria-label={`Remove ${attachment.name}`}
            title="Remove attachment"
          >
            ×
          </button>
        </div>
      )}
      {attachError && (
        <div className="input-attachment-error" role="alert">
          {attachError}
        </div>
      )}

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

        {/* Hidden file input — driven entirely from the paperclip
            button below. accept= covers the four types in spec
            (image/*, .pdf, .txt, .md); MAX_ATTACHMENT_BYTES is the
            client-side guard. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={onFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        <div className="input-toolbar">
          <button
            type="button"
            className="input-tool-btn"
            title="Attach file"
            aria-label="Attach file"
            disabled={toolBtnDisabled}
            onClick={() => fileInputRef.current?.click()}
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
            title="Quick commands"
            aria-label="Open quick commands"
            disabled={toolBtnDisabled || !onShortcutSend}
            onClick={() => setSheetOpen(true)}
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

      <ShortcutSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onShortcutSend={onShortcutSendInternal}
        onNewDirective={onNewDirectiveInternal}
      />
    </div>
  );
}
