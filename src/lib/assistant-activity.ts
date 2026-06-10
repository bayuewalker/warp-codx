"use client";

/**
 * Tiny cross-component signal for "the assistant is actively generating".
 *
 * The top status strip (ProviderStatusBar) lives above the app shell while the
 * streaming state lives inside ChatArea, so rather than lifting state through
 * several layers we broadcast a window CustomEvent. ChatArea calls
 * `emitAssistantActivity(working)` whenever its stream starts/stops, and the
 * strip subscribes via `useAssistantActivity()` to colour its LED (idle vs
 * working) in realtime.
 */
import { useEffect, useState } from "react";

const EVENT = "warp:assistant-activity";

export function emitAssistantActivity(working: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { working } }));
}

export function useAssistantActivity(): boolean {
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      setWorking(Boolean((e as CustomEvent<{ working?: boolean }>).detail?.working));
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
  return working;
}
