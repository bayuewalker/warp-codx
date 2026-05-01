"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";

type Warning = {
  id: string;
  session_id: string;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
};

type Props = {
  sessionId: string | null;
};

const STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Realtime amber banner above the chat area.
 *
 * Subscribes to chat_warnings for the active session via Supabase
 * Realtime. Shows the most recent warn/error row. Auto-clears when
 * a row older than STALE_AFTER_MS is the only one (i.e. session
 * resumed without further warnings).
 *
 * Visual treatment kept minimal — single line, small icon, dismiss
 * button, no layout shift in the rest of the page (banner inserts
 * above the messages list inside the existing flex column).
 */
export default function WarningBanner({ sessionId }: Props) {
  const [latest, setLatest] = useState<Warning | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Initial backfill: fetch the most recent non-dismissed warning
  // for the session via the Supabase REST surface.
  useEffect(() => {
    if (!sessionId) {
      setLatest(null);
      setDismissedId(null);
      return;
    }

    let cancelled = false;
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    supabase
      .from("chat_warnings")
      .select("id, session_id, level, message, created_at")
      .eq("session_id", sessionId)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        const row = (data ?? [])[0] as Warning | undefined;
        if (!row) return;
        // Skip stale (>10 min) rows on initial load.
        const age = Date.now() - new Date(row.created_at).getTime();
        if (age > STALE_AFTER_MS) return;
        setLatest(row);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Realtime subscription for new warnings.
  useEffect(() => {
    if (!sessionId) return;
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    const channel = supabase
      .channel(`warnings:${sessionId}`)
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
          setLatest(w);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // Auto-clear once the latest is older than STALE_AFTER_MS.
  useEffect(() => {
    if (!latest) return;
    const age = Date.now() - new Date(latest.created_at).getTime();
    const remaining = STALE_AFTER_MS - age;
    if (remaining <= 0) {
      setLatest(null);
      return;
    }
    const t = setTimeout(() => setLatest(null), remaining);
    return () => clearTimeout(t);
  }, [latest]);

  if (!latest || dismissedId === latest.id) return null;

  return (
    <div
      className="warn-banner"
      role="status"
      aria-live="polite"
      data-level={latest.level}
    >
      <span className="warn-banner-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="warn-banner-msg">{latest.message}</span>
      <button
        type="button"
        className="warn-banner-close"
        onClick={() => setDismissedId(latest.id)}
        aria-label="Dismiss warning"
      >
        ×
      </button>
    </div>
  );
}
