"use client";

/**
 * Shared client hook for the live LLM provider connection status.
 *
 * Polls `/api/provider/status` (which pings the active provider's `/models`
 * endpoint server-side) every `pollMs`, plus on tab focus and when the browser
 * regains connectivity. Used by both the top status strip (ProviderStatusBar)
 * and the chat input footer so the LED + model label are the *real*, live
 * provider state — never a hardcoded value — and stay consistent across the UI.
 */
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "./api-fetch";

export type ProviderStatusValue = {
  status: "online" | "degraded" | "offline";
  reason: string;
  provider: string | null;
  model: string | null;
  providerCount: number;
  checkedAt: string;
};

export type LiveStatus = "online" | "degraded" | "offline" | "checking";

export function useProviderStatus(pollMs = 15_000): {
  data: ProviderStatusValue | null;
  status: LiveStatus;
} {
  const [data, setData] = useState<ProviderStatusValue | null>(null);
  const [status, setStatus] = useState<LiveStatus>("checking");

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch("/api/provider/status", { cache: "no-store" });
      if (res.status === 401) {
        setStatus("checking");
        setData(null);
        return;
      }
      if (!res.ok) {
        setStatus("offline");
        return;
      }
      const json = (await res.json()) as ProviderStatusValue;
      setData(json);
      setStatus(json.status);
    } catch {
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive) void refresh();
    };
    tick();
    const id = window.setInterval(tick, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const onOnline = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh, pollMs]);

  return { data, status };
}
