"use client";

import type { Message } from "@/lib/types";
import { cn } from "@/lib/cn";
import MessageContent from "./MessageContent";

type Props = {
  message: Message;
  streaming?: boolean;
};

export default function MessageBubble({ message, streaming = false }: Props) {
  const isUser = message.role === "user";
  const hasContent = message.content.length > 0;

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[88%] md:max-w-[78%] break-words",
          "px-3.5 py-2.5 rounded-lg text-[13px] leading-relaxed",
          isUser
            ? "bg-warp-blue/15 text-white border-hair border-warp-blue/30"
            : "bg-white/[0.025] text-white/90 border-hair border-warp-border",
          streaming && "warp-cursor",
        )}
      >
        {hasContent ? (
          <MessageContent content={message.content} role={message.role} />
        ) : (
          "\u00A0"
        )}
      </div>
    </div>
  );
}
