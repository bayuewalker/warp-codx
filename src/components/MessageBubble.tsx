"use client";

import type { Message } from "@/lib/types";
import { cn } from "@/lib/cn";
import MessageContent from "./MessageContent";

type Props = {
  message: Message;
  streaming?: boolean;
  /** Phase 3b — passed through to MessageContent for IssueCard create POST. */
  sessionId?: string | null;
};

/**
 * Renders a single message turn. v2 design has no bubble container —
 * both user and assistant turns flow as plain blocks.
 *
 * Alignment (standard chat convention — WhatsApp / iMessage pattern):
 *   - user turns      → right side (block constrained to ~75% width,
 *                       pushed to the right with margin-left:auto via
 *                       `justify-end`). Inline text inside still flows
 *                       left-to-right for readability.
 *   - assistant + system turns → left side, full width as before.
 *
 * Only the alignment/positioning is changed here — colors, fonts, and
 * inner styling are untouched (the right-side text is identical to the
 * left-side variant from `.message-content--user`).
 */
export default function MessageBubble({
  message,
  streaming = false,
  sessionId = null,
}: Props) {
  const hasContent = message.content.length > 0;
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "w-full flex",
        isUser ? "justify-end" : "justify-start",
        streaming && "warp-cursor",
      )}
    >
      <div
        className={cn(
          isUser
            ? "max-w-[75%] bg-warp-blue/15 border border-warp-blue/25 px-[14px] py-[10px] rounded-[16px] rounded-br-[4px] text-right"
            : "w-full",
        )}
      >
        {hasContent ? (
          <MessageContent
            content={message.content}
            role={message.role}
            sessionId={sessionId}
          />
        ) : (
          <span aria-hidden="true">&nbsp;</span>
        )}
      </div>
    </div>
  );
}
