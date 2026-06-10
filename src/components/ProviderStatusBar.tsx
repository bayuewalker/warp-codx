"use client";

/**
 * Top status strip.
 *
 * Left:  ● W.A.R.P · <model>  — a *live* connection LED for the active LLM
 *        provider (top of the failover chain) plus the real model name. The
 *        LED polls `/api/provider/status` (~15s + on focus/online) so it
 *        reflects the actual connection state:
 *          teal  (online)   — provider reachable, key accepted
 *          amber (degraded) — reachable but key rejected / out of credit / rate-limited
 *          red   (offline)  — unreachable, timed out, or no key configured
 *          grey  (checking) — first probe in flight / not signed in
 * Right: the app version.
 *
 * Text is intentionally small (mono, 10px) to match the model line in the
 * composer footer.
 */
import { useProviderStatus, type LiveStatus } from "@/lib/use-provider-status";

const LED_CLASS: Record<LiveStatus, string> = {
  online: "led-online led-pulse",
  degraded: "led-busy",
  offline: "led-offline",
  checking: "led-idle",
};

const REASON_LABEL: Record<string, string> = {
  "no-providers": "no key",
  auth: "key rejected",
  limit: "no credit",
  upstream: "upstream error",
  timeout: "timeout",
  network: "unreachable",
};

export default function ProviderStatusBar({ version = "v0.1" }: { version?: string }) {
  const { data, status } = useProviderStatus();

  // Right-hand label: model when online, the failure reason when not.
  const statusText =
    status === "checking"
      ? "connecting…"
      : status === "offline"
        ? REASON_LABEL[data?.reason ?? ""] ?? "offline"
        : status === "degraded"
          ? REASON_LABEL[data?.reason ?? ""] ?? "degraded"
          : data?.model ?? "llm";

  const title = data
    ? `LLM provider: ${data.provider ?? "none"}` +
      (data.model ? ` · ${data.model}` : "") +
      ` · ${data.providerCount} configured · ${status}` +
      (data.reason && data.reason !== "ok" ? ` (${data.reason})` : "")
    : "Checking LLM provider connection…";

  return (
    <div
      className="flex items-center gap-2 px-3 h-6 shrink-0 border-b border-hair
        bg-warp-bg font-mono text-[10px] tracking-normal text-white/40
        select-none"
      role="status"
      aria-label="System status"
    >
      <span className="inline-flex items-center gap-1.5 min-w-0" title={title}>
        <span className={`led-dot ${LED_CLASS[status]}`} aria-hidden="true" />
        <span className="text-white/55">W.A.R.P</span>
        <span className="text-white/20">·</span>
        <span className="truncate text-white/45">{statusText}</span>
      </span>

      <span className="ml-auto shrink-0 text-white/25">{version}</span>
    </div>
  );
}
