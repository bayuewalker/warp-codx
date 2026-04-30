"use client";

import { useMemo } from "react";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  message: Message;
  streaming?: boolean;
};

const BRANCH_RE = /WARP\/[\w-]+/g;
const GITHUB_USER = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "";

function branchUrl(branch: string): string {
  // If the user later adds NEXT_PUBLIC_GITHUB_REPO=user/repo, build a real
  // GitHub URL. Otherwise link to a Google search so the badge always works.
  if (GITHUB_USER && /^[\w.-]+\/[\w.-]+$/.test(GITHUB_USER)) {
    return `https://github.com/${GITHUB_USER}/tree/${encodeURIComponent(branch)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(branch)}`;
}

/**
 * Renders message text and turns any "WARP/{slug}" reference into a clickable
 * blue badge.
 */
function renderWithBranches(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(BRANCH_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    const label = match[0];
    parts.push(
      <a
        key={`b-${key++}`}
        href={branchUrl(label)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5
          rounded text-[11px] leading-none text-warp-blue
          bg-warp-blue/10 border-hair border-warp-blue/35
          hover:bg-warp-blue/20"
      >
        <span className="opacity-70">⎇</span>
        <span className="font-medium">{label}</span>
      </a>,
    );
    lastIndex = idx + label.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export default function MessageBubble({ message, streaming = false }: Props) {
  const isUser = message.role === "user";
  const rendered = useMemo(
    () => renderWithBranches(message.content),
    [message.content],
  );

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[88%] md:max-w-[78%] whitespace-pre-wrap break-words",
          "px-3.5 py-2.5 rounded-lg text-[13px] leading-relaxed",
          isUser
            ? "bg-warp-blue/15 text-white border-hair border-warp-blue/30"
            : "bg-white/[0.025] text-white/90 border-hair border-warp-border",
          streaming && "warp-cursor",
        )}
      >
        {rendered.length > 0 ? rendered : "\u00A0"}
      </div>
    </div>
  );
}
