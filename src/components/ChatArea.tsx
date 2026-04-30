"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";
import type { Message, Session } from "@/lib/types";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import { cn } from "@/lib/cn";

type Props = {
  sessionId: string | null;
  onOpenDrawer: () => void;
  onNewDirective: () => void;
  onSessionUpdated: (s: Session) => void;
};

export default function ChatArea({
  sessionId,
  onOpenDrawer,
  onNewDirective,
  onSessionUpdated,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  // Queue of optimistic user messages we still expect Realtime to confirm.
  // Each entry pairs the temp id with the trimmed content so that when the
  // persisted row arrives we can swap the temp row out (instead of doubling).
  const pendingUserOptimistic = useRef<
    Array<{ tempId: string; content: string }>
  >([]);

  // Auto-scroll to bottom when messages or streaming text update.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Load messages whenever the active session changes.
  useEffect(() => {
    seenIds.current = new Set();
    pendingUserOptimistic.current = [];
    setMessages([]);
    setStreamingText("");
    setStreaming(false);
    if (!sessionId) return;

    let cancelled = false;
    setLoading(true);
    fetch(`/api/messages?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((json: { messages: Message[] }) => {
        if (cancelled) return;
        const list = json.messages ?? [];
        seenIds.current = new Set(list.map((m) => m.id));
        setMessages(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        setTimeout(scrollToBottom, 0);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, scrollToBottom]);

  // Realtime subscription for the active session.
  useEffect(() => {
    if (!sessionId) return;
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    const channel = supabase
      .channel(`messages:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          if (seenIds.current.has(m.id)) return;
          seenIds.current.add(m.id);

          // If this is the persisted version of an optimistic user message,
          // swap it in place instead of appending a duplicate.
          if (m.role === "user") {
            const queue = pendingUserOptimistic.current;
            const idx = queue.findIndex((p) => p.content === m.content);
            if (idx !== -1) {
              const { tempId } = queue[idx];
              queue.splice(idx, 1);
              setMessages((prev) => {
                const tIdx = prev.findIndex((x) => x.id === tempId);
                if (tIdx === -1) return [...prev, m];
                const next = prev.slice();
                next[tIdx] = m;
                return next;
              });
              setTimeout(scrollToBottom, 0);
              return;
            }
          }

          setMessages((prev) => [...prev, m]);
          setTimeout(scrollToBottom, 0);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingText, scrollToBottom]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!sessionId || !text.trim() || streaming) return;
      const trimmed = text.trim();

      // Optimistic user message. Track its temp id + content so that when
      // Realtime delivers the persisted row we can swap it in place rather
      // than rendering both the temp and the real row.
      const optimisticUserId = `temp-user-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const nowIso = new Date().toISOString();
      pendingUserOptimistic.current.push({
        tempId: optimisticUserId,
        content: trimmed,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticUserId,
          session_id: sessionId,
          role: "user",
          content: trimmed,
          created_at: nowIso,
        },
      ]);
      setStreaming(true);
      setStreamingText("");
      setTimeout(scrollToBottom, 0);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, content: trimmed }),
        });

        if (!res.ok || !res.body) {
          const errJson = await res.json().catch(() => ({}));
          const message =
            (errJson && (errJson as { error?: string }).error) ||
            `Request failed (${res.status})`;
          setStreamingText(`[WARP•SENTINEL] ${message}`);
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            acc += decoder.decode(value, { stream: true });
            setStreamingText(acc);
          }
        }
        // Final flush
        acc += decoder.decode();
        setStreamingText(acc);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream failed";
        setStreamingText(`[WARP•SENTINEL] ${message}`);
      } finally {
        setStreaming(false);
        // Refresh messages so the persisted user + assistant rows take over
        // from the optimistic + streaming text. Realtime usually beats this,
        // but the refetch guarantees consistency.
        try {
          const r = await fetch(
            `/api/messages?sessionId=${encodeURIComponent(sessionId)}`,
            { cache: "no-store" },
          );
          if (r.ok) {
            const json = (await r.json()) as { messages: Message[] };
            const list = json.messages ?? [];
            seenIds.current = new Set(list.map((m) => m.id));
            pendingUserOptimistic.current = [];
            setMessages(list);
            setStreamingText("");
          }
        } catch {
          /* ignore */
        }
        // Refresh session row (label may have changed).
        try {
          const r = await fetch("/api/sessions", { cache: "no-store" });
          if (r.ok) {
            const json = (await r.json()) as { sessions: Session[] };
            const updated = json.sessions.find((s) => s.id === sessionId);
            if (updated) onSessionUpdated(updated);
          }
        } catch {
          /* ignore */
        }
      }
    },
    [sessionId, streaming, scrollToBottom, onSessionUpdated],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar (mobile) */}
      <header
        className={cn(
          "md:hidden flex items-center justify-between px-3 py-2.5",
          "border-b border-hair bg-warp-bg",
        )}
      >
        <button
          type="button"
          aria-label="Open sessions"
          onClick={onOpenDrawer}
          className="w-9 h-9 -ml-1 rounded-md text-white/70 hover:text-white hover:bg-white/[0.06] flex flex-col items-center justify-center gap-1"
        >
          <span className="block w-4 h-px bg-current" />
          <span className="block w-4 h-px bg-current" />
          <span className="block w-4 h-px bg-current" />
        </button>
        <div className="flex items-baseline gap-2 text-[13px]">
          <span className="text-warp-blue">WARP</span>
          <span className="text-white/80">CodX</span>
        </div>
        <button
          type="button"
          aria-label="New directive"
          onClick={onNewDirective}
          className="w-9 h-9 -mr-1 rounded-md text-warp-blue hover:bg-warp-blue/15 flex items-center justify-center text-lg"
        >
          +
        </button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto warp-scroll px-3 md:px-6 pt-4 pb-3"
      >
        {!sessionId ? (
          <EmptyState onNewDirective={onNewDirective} />
        ) : loading ? (
          <div className="text-xs text-white/35 px-1">Loading messages…</div>
        ) : messages.length === 0 && !streaming ? (
          <EmptyConversation />
        ) : (
          <ul className="flex flex-col gap-3 max-w-3xl mx-auto w-full">
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} />
              </li>
            ))}
            {streaming && (
              <li>
                <MessageBubble
                  message={{
                    id: "streaming",
                    session_id: sessionId,
                    role: "assistant",
                    content: streamingText,
                    created_at: new Date().toISOString(),
                  }}
                  streaming
                />
                {streamingText.length === 0 && (
                  <div className="mt-1 ml-1 text-[11px] text-white/45 warp-pulse">
                    WARP🔹CMD is thinking…
                  </div>
                )}
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-hair bg-warp-bg kb-inset">
        <div className="max-w-3xl mx-auto w-full px-3 md:px-6 py-3">
          <ChatInput
            disabled={!sessionId || streaming}
            placeholder={
              !sessionId
                ? "Start a new directive to begin…"
                : streaming
                  ? "WARP🔹CMD is responding…"
                  : "Issue a directive to WARP🔹CMD…"
            }
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onNewDirective }: { onNewDirective: () => void }) {
  return (
    <div className="h-full flex items-center justify-center text-center px-6">
      <div className="max-w-sm">
        <div className="text-warp-blue text-sm tracking-wide">WARP CodX</div>
        <h1 className="mt-2 text-white/90 text-lg leading-snug">
          Command interface for WalkerMind&nbsp;OS
        </h1>
        <p className="mt-3 text-[12px] text-white/50 leading-relaxed">
          Direct WARP🔹CMD. Dispatch tasks to FORGE, SENTINEL, and ECHO.
          Branches use{" "}
          <span className="text-warp-blue">WARP/&#123;feature-slug&#125;</span>.
        </p>
        <button
          type="button"
          onClick={onNewDirective}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-md
            bg-warp-blue/10 hover:bg-warp-blue/20 active:bg-warp-blue/30
            border-hair border-warp-blue/40 text-warp-blue text-sm"
        >
          <span>+</span>
          <span>New directive</span>
        </button>
      </div>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="h-full flex items-center justify-center text-center px-6">
      <div className="max-w-sm text-[12px] text-white/45 leading-relaxed">
        Awaiting directive. Anything you send is routed through WARP🔹CMD,
        which decides whether FORGE, SENTINEL, or ECHO takes the task.
      </div>
    </div>
  );
}
