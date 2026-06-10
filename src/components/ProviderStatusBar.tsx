"use client";

/**
 * Top-bar LLM provider connection status strip.
 *
 * Renders a compact row of status LEDs — the headline one being a *live*
 * indicator of whether the active LLM provider (the top of the failover chain)
 * is reachable and accepting the key. It polls `/api/provider/status` every
 * ~15s (and on tab focus / network changes), so the LED reflects the real
 * connection state in near-realtime:
 *
 *   teal  (online)   — provider reachable, key accepted
 *   amber (degraded) — reachable but key rejected / out of credit / rate-limited
 *   red   (offline)  — unreachable, timed out, or no key configured
 *   grey  (checking) — first probe in flight / not signed in
 *
 * NET mirrors the browser's online/offline state. The strip is intentionally
 * read-only and self-contained so it can sit above the whole app shell.
 */
import { useEffect, useState } from "react";
import { useProviderStatus, type LiveStatus } from "@/lib/use-provider-status";

const LED_CLASS: Record<LiveStatus, string> = {
  online: "led-online led-pulse",
  degraded: "led-busy",
  offline: "led-offline",
  checking: "led-idle",
};

const REASON_LABEL: Record<string, string> = {
  "no-providers": "NO KEY",
  auth: "KEY REJECTED",
  limit: "NO CREDIT",
  upstream: "UPSTREAM",
  timeout: "TIMEOUT",
  network: "UNREACHABLE",
};

export default function ProviderStatusBar({ version = "v0.1" }: { version?: string }) {
  const { data, status } = useProviderStatus();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const syncNet = () => {
      setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    };
    syncNet();
    window.addEventListener("online", syncNet);
    window.addEventListener("offline", syncNet);
    return () => {
      window.removeEventListener("online", syncNet);
      window.removeEventListener("offline", syncNet);
    };
  }, []);

  const providerLabel =
    status === "offline"
      ? REASON_LABEL[data?.reason ?? ""] ?? "OFFLINE"
      : status === "degraded"
        ? REASON_LABEL[data?.reason ?? ""] ?? "DEGRADED"
        : (data?.provider ?? "LLM").toUpperCase();

  const title = data
    ? `LLM provider: ${data.provider ?? "none"}` +
      (data.model ? ` · ${data.model}` : "") +
      ` · ${data.providerCount} configured · ${status}` +
      (data.reason && data.reason !== "ok" ? ` (${data.reason})` : "")
    : "Checking LLM provider connection…";

  return (
    <div
      className="flex items-center gap-4 px-3 h-7 shrink-0 border-b border-hair
        bg-warp-bg text-[10px] uppercase tracking-[0.18em] text-white/45
        select-none"
      role="status"
      aria-label="System status"
    >
      {/* NET — browser connectivity */}
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`led-dot ${online ? "led-online" : "led-offline"}`}
          aria-hidden="true"
        />
        NET
      </span>

      {/* LLM — live provider connection (the headline LED) */}
      <span className="inline-flex items-center gap-1.5" title={title}>
        <span className={`led-dot ${LED_CLASS[status]}`} aria-hidden="true" />
        <span className="text-white/55">{providerLabel}</span>
      </span>

      {/* Model slug — shown when known, hidden on very small screens */}
      {data?.model && status !== "offline" && (
        <span className="hidden sm:inline text-white/30 normal-case tracking-normal">
          {data.model}
        </span>
      )}

      <span className="ml-auto text-white/30">W.A.R.P · {version}</span>
    </div>
  );
}
