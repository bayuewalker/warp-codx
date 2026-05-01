"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";

type Warning = {
  id: string;
  session_id: string | null;
  level: string;
  message: string;
  created_at: string;
  dismissed_at: string | null;
};

const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Realtime warning banner. Subscribes to `chat_warnings` for the active
 * session, shows the most recent non-dismissed entry, and auto-clears
 * once the warning is older than the cache TTL.
 */
export default function ConstitutionWarningBanner({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const [warning, setWarning] = useState<Warning | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    setWarning(null);
    setDismissed(new Set());
    if (!sessionId) return;

    let cancelled = false;
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    void supabase
      .from("chat_warnings")
      .select("id, session_id, level, message, created_at, dismissed_at")
      .eq("session_id", sessionId)
      .is("dismissed_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setWarning(data as Warning);
      });

    const channel = supabase
      .channel(`chat_warnings:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_warnings",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const w = payload.new as Warning;
          setWarning(w);
        },
      )
      .subscribe();

    const sweep = setInterval(() => {
      setWarning((cur) => {
        if (!cur) return cur;
        const age = Date.now() - new Date(cur.created_at).getTime();
        return age > STALE_AFTER_MS ? null : cur;
      });
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(sweep);
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [sessionId]);

  if (!sessionId) return null;
  if (!warning) return null;
  if (dismissed.has(warning.id)) return null;

  const tone: "error" | "info" | "warn" =
    warning.level === "error"
      ? "error"
      : warning.level === "info"
        ? "info"
        : "warn";

  return (
    <div className="constitution-banner" data-tone={tone} role="status">
      <span className="constitution-banner-icon" aria-hidden="true">
        {tone === "error" ? "✕" : tone === "info" ? "i" : "!"}
      </span>
      <span className="constitution-banner-text">{warning.message}</span>
      <button
        type="button"
        className="constitution-banner-close"
        aria-label="Dismiss warning"
        onClick={() =>
          setDismissed((prev) => {
            const n = new Set(prev);
            n.add(warning.id);
            return n;
          })
        }
      >
        ×
      </button>
    </div>
  );
}
