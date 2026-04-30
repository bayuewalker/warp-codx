"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";
import type { Message, Session, TodosPayload } from "@/lib/types";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import SessionBar from "./SessionBar";
import { cn } from "@/lib/cn";

type Props = {
  sessionId: string | null;
  sessionLabel: string | null;
  onOpenDrawer: () => void;
  onNewDirective: () => void;
  onSessionUpdated: (s: Session) => void;
};

export default function ChatArea({
  sessionId,
  sessionLabel,
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
        acc += decoder.decode();
        setStreamingText(acc);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream failed";
        setStreamingText(`[WARP•SENTINEL] ${message}`);
      } finally {
        setStreaming(false);
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

  // Derive a 0–100 progress percentage from the last assistant message's
  // todo block, when present. The todo payload is parsed out of any
  // ```warp-todos … ``` fence in the most recent assistant turn.
  const sessionProgress = useMemo(
    () => extractTodoProgress(messages),
    [messages],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Status strip — 26px sticky band with NET / RT / RUN / AGT LEDs.
          NET + RT light up unconditionally (network is implied alive while
          the page renders). RUN pulses amber whenever a stream is in
          flight, otherwise stays amber-still while a session is selected,
          and dims when no session is active. AGT stays idle until Task #3
          wires real agent state. */}
      <header className="status-strip" role="banner">
        <div className="status-led">
          <span className="led-dot led-online" aria-label="Network online" />
          NET
        </div>
        <div className="status-led">
          <span className="led-dot led-online" aria-label="Realtime connected" />
          RT
        </div>
        <div className="status-led">
          <span
            className={cn(
              "led-dot",
              streaming
                ? "led-busy led-pulse"
                : sessionId
                  ? "led-busy"
                  : "led-idle",
            )}
            aria-label={
              streaming
                ? "Streaming"
                : sessionId
                  ? "Run state ready"
                  : "Run state idle"
            }
          />
          RUN
        </div>
        <div className="status-led">
          <span className="led-dot led-idle" aria-label="Agent idle" />
          AGT
        </div>
        <span className="status-spacer" />
        <span className="status-version">W.A.R.P · v0.1</span>
      </header>

      {/* App header — 44px. Hamburger left (mobile only — drawer is the
          persistent sidebar on desktop), wordmark center, new-directive
          plus right. */}
      <div className="app-header">
        <button
          type="button"
          className="header-icon-btn md:invisible"
          onClick={onOpenDrawer}
          aria-label="Open sessions"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="brand-wordmark">
          <span className="brand-warp">WARP</span> CodX
        </span>
        <button
          type="button"
          className="header-icon-btn"
          onClick={onNewDirective}
          aria-label="New directive"
          title="New directive"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Session bar — appears when a session is active. */}
      <SessionBar
        taskTitle={sessionLabel ?? undefined}
        progressPercent={sessionProgress}
        onTap={onOpenDrawer}
      />

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto warp-scroll px-4 md:px-6 pt-4 pb-3"
      >
        {!sessionId ? (
          <EmptyState onNewDirective={onNewDirective} />
        ) : loading ? (
          <div className="text-xs text-warp-text-mute px-1">Loading messages…</div>
        ) : messages.length === 0 && !streaming ? (
          <EmptyConversation />
        ) : (
          <ul className="flex flex-col gap-[22px] max-w-3xl mx-auto w-full">
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
                  <div className="mt-1 text-[11px] text-white/45 warp-pulse">
                    WARP🔹CMD is thinking…
                  </div>
                )}
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Input */}
      <div className="bg-warp-bg kb-inset">
        <div className="max-w-3xl mx-auto w-full px-3 md:px-6 pt-3 pb-3">
          <ChatInput
            disabled={!sessionId}
            isStreaming={streaming}
            placeholder={
              !sessionId
                ? "Start a new directive to begin…"
                : streaming
                  ? "WARP CMD is responding…"
                  : "Describe your task or type / for commands"
            }
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Walk the last assistant message looking for a ```warp-todos JSON
 * fence; if found, return done/total * 100. Returns undefined when no
 * todo block is present so SessionBar can hide the rail entirely.
 */
function extractTodoProgress(messages: Message[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const match = m.content.match(/```warp-todos\s*\n([\s\S]*?)```/);
    if (!match) return undefined;
    try {
      const payload = JSON.parse(match[1]) as TodosPayload;
      const total = payload.total ?? payload.items.length;
      if (!total) return 0;
      const done =
        payload.done ?? payload.items.filter((it) => it.state === "done").length;
      return Math.round((done / total) * 100);
    } catch {
      return undefined;
    }
  }
  return undefined;
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
