"use client";

/**
 * Phase 4 — push notification toggle (used inside ConstitutionSettings).
 *
 * Renders three states:
 *   - "unsupported"      → flat informational row (greyed out)
 *   - "denied"           → explanation + link to browser settings
 *   - "default" / "off"  → "OFF" label + ENABLE button
 *   - "subscribed"       → "ON" label + DISABLE button + TEST button
 *
 * The toggle owns the entire push lifecycle (permission, SW
 * registration, subscribe POST, unsubscribe POST). It does NOT depend
 * on the layout's auto-registration — both code paths converge on
 * the same SW URL so they cooperate.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getCurrentSubscription,
  getPushPermission,
  isPushSupported,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "@/lib/push-client";

type LiveState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "off" } // permission default OR granted-but-no-subscription
  | { kind: "on" };

export default function PushNotificationToggle() {
  const [state, setState] = useState<LiveState>({ kind: "loading" });
  const [busy, setBusy] = useState<null | "enable" | "disable" | "test">(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setState({ kind: "unsupported" });
      return;
    }
    const perm = getPushPermission();
    if (perm === "denied") {
      setState({ kind: "denied" });
      return;
    }
    const sub = await getCurrentSubscription();
    setState({ kind: sub ? "on" : "off" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onEnable = useCallback(async () => {
    setBusy("enable");
    setFlash(null);
    try {
      await subscribePush();
      setFlash("Notifications enabled.");
      await refresh();
    } catch (err) {
      setFlash(
        err instanceof Error ? err.message : "failed to enable notifications",
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const onDisable = useCallback(async () => {
    setBusy("disable");
    setFlash(null);
    try {
      await unsubscribePush();
      setFlash("Notifications disabled.");
      await refresh();
    } catch (err) {
      setFlash(
        err instanceof Error ? err.message : "failed to disable notifications",
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const onTest = useCallback(async () => {
    setBusy("test");
    setFlash(null);
    try {
      await sendTestPush();
      setFlash("Test notification sent.");
    } catch (err) {
      setFlash(
        err instanceof Error ? err.message : "test notification failed",
      );
    } finally {
      setBusy(null);
    }
  }, []);

  const liveOn = state.kind === "on";
  const liveOff = state.kind === "off";

  return (
    <div>
      <div className="cs-section-title">Notifications</div>

      <div
        className="cs-pat"
        data-ok={liveOn ? "true" : liveOff ? undefined : "false"}
        style={{ marginBottom: 10 }}
      >
        <div className="cs-pat-label">
          {state.kind === "loading" && "Checking…"}
          {state.kind === "unsupported" && "Not supported in this browser"}
          {state.kind === "denied" && "Blocked by browser"}
          {state.kind === "off" && "Push notifications: OFF"}
          {state.kind === "on" && "Push notifications: ON"}
        </div>
        <div className="cs-pat-detail">
          {state.kind === "unsupported" &&
            "This browser doesn't support Web Push. Try Chrome, Edge, or Firefox."}
          {state.kind === "denied" &&
            "Notifications are blocked. Enable them in your browser's site settings, then reload."}
          {state.kind === "off" &&
            "Get a push when a PR is merged / closed / held, an issue is created, or the constitution refreshes."}
          {state.kind === "on" &&
            "PR merged · closed · held · Issue created · Constitution refreshed"}
        </div>
      </div>

      {flash && <div className="cs-flash">{flash}</div>}

      <div className="cs-actions">
        {state.kind === "off" && (
          <button
            type="button"
            className="cs-action"
            onClick={() => void onEnable()}
            disabled={busy !== null}
          >
            {busy === "enable" ? "Enabling…" : "ENABLE PUSH"}
          </button>
        )}
        {state.kind === "on" && (
          <>
            <button
              type="button"
              className="cs-action"
              onClick={() => void onDisable()}
              disabled={busy !== null}
            >
              {busy === "disable" ? "Disabling…" : "DISABLE PUSH"}
            </button>
            <button
              type="button"
              className="cs-action"
              onClick={() => void onTest()}
              disabled={busy !== null}
            >
              {busy === "test" ? "Sending…" : "TEST NOTIFICATION"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
