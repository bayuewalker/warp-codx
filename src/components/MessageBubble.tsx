"use client";

import type { Message } from "@/lib/types";
import { cn } from "@/lib/cn";
import MessageContent from "./MessageContent";

type Props = {
  message: Message;
  streaming?: boolean;
};

/**
 * Renders a single message turn. v2 design has no bubble container —
 * both user and assistant turns flow as plain blocks. The user turn is
 * left-aligned with weight-500 prose; the assistant turn is a vertical
 * stack of prose + rich blocks.
 */
export default function MessageBubble({ message, streaming = false }: Props) {
  const hasContent = message.content.length > 0;

  return (
    <div className={cn("w-full", streaming && "warp-cursor")}>
      {hasContent ? (
        <MessageContent content={message.content} role={message.role} />
      ) : (
        <span aria-hidden="true">&nbsp;</span>
      )}
    </div>
  );
}
