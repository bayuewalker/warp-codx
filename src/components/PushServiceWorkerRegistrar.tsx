"use client";

/**
 * Phase 4 — auto-registers the Web Push service worker on mount.
 *
 * Mounted once from the root layout. Idempotent: if the SW is already
 * registered (cached registration), this does nothing. Failures are
 * logged to console but never thrown — the app must boot even if push
 * is unavailable (older browser, file:// origin, etc).
 *
 * NOTE: this only REGISTERS the SW. It does NOT request notification
 * permission — that happens explicitly when the operator toggles ON
 * inside Settings. We register up-front so that if a permission was
 * previously granted, the SW is ready to receive a push the moment
 * the page loads, instead of waiting for the user to open Settings.
 */
import { useEffect } from "react";
import { isPushSupported, registerServiceWorker } from "@/lib/push-client";

export default function PushServiceWorkerRegistrar() {
  useEffect(() => {
    if (!isPushSupported()) return;
    registerServiceWorker().catch((err) => {
      console.error(
        `[push-sw] register failed: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
    });
  }, []);
  return null;
}
