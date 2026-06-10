"use client";

/**
 * Top status strip.
 *
 * Left:  ● W.A.R.P · <model> · <state>
 *        - The LED + state word are *live*: the LED reflects the real provider
 *          connection (polled from `/api/provider/status`) and flips to a blue
 *          "working" pulse while the assistant is actively generating.
 *            blue  (working)  — assistant is streaming a reply right now
 *            teal  (idle)     — provider reachable, key accepted, ready
 *            amber (degraded) — reachable but key rejected / no credit / limited
 *            red   (offline)  — unreachable, timed out, or no key configured
 *            grey  (checking) — first probe in flight / not signed in
 *        - <model> is the real active model.
 * Right: the app version.
 *
 * Text is small (mono, 10px) to match the model line in the composer footer.
 */
import { useProviderStatus, type LiveStatus } from "@/lib/use-provider-status";
import { useAssistantActivity } from "@/lib/assistant-activity";

type StripState = LiveStatus | "working";

const LED_CLASS: Record<StripState, string> = {
  working: "led-working led-pulse",
  online: "led-online led-pulse",
  degraded: "led-busy",
  offline: "led-offline",
  checking: "led-idle",
};

const STATE_COLOR: Record<StripState, string> = {
  working: "text-warp-blue",
  online: "text-warp-teal/70",
  degraded: "text-warp-amber",
  offline: "text-warp-red",
  checking: "text-white/35",
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
  const working = useAssistantActivity();

  // Working overrides the connection status (it implies we're online).
  const state: StripState = working ? "working" : status;

  const stateWord =
    state === "working"
      ? "working"
      : state === "checking"
        ? "connecting…"
        : state === "offline"
          ? REASON_LABEL[data?.reason ?? ""] ?? "offline"
          : state === "degraded"
            ? REASON_LABEL[data?.reason ?? ""] ?? "degraded"
            : "idle";

  const model = data?.model ?? (status === "checking" ? "connecting…" : "llm");

  const title = data
    ? `LLM provider: ${data.provider ?? "none"}` +
      (data.model ? ` · ${data.model}` : "") +
      ` · ${data.providerCount} configured · ${state}` +
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
        <span className={`led-dot ${LED_CLASS[state]}`} aria-hidden="true" />
        <span className="text-white/55 shrink-0">W.A.R.P</span>
        <span className="text-white/20 shrink-0">·</span>
        <span className="truncate text-white/45">{model}</span>
        <span className="text-white/20 shrink-0">·</span>
        <span className={`shrink-0 ${STATE_COLOR[state]}`}>{stateWord}</span>
      </span>

      <span className="ml-auto shrink-0 text-white/25">{version}</span>
    </div>
  );
}
