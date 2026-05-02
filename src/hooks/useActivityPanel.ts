"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ActivityItem = {
  id: string;
  label: string;
  meta?: string;
  state: "done" | "active" | "pending";
};

// ─── Item extraction ─────────────────────────────────────────────────────────

/**
 * Scan the accumulated streaming text for actionable signals and return a
 * stable list of items (in encounter order) without state annotations.
 *
 * Sources (checked in order, de-duplicated by an encounter ID):
 *   1. Fenced ```warp-action / warp-diff / warp-todos / warp-status blocks —
 *      parses the JSON body for "summary" and "path".
 *   2. Lines starting with `ACTION:` or `TOOL:` (raw text from CMD).
 *   3. ISSUE_DRAFT and PR_ACTION HTML comment markers.
 */
function extractRawItems(text: string): Omit<ActivityItem, "state">[] {
  const found: Omit<ActivityItem, "state">[] = [];
  const seen = new Set<string>();

  // 1. Fenced warp-* rich blocks
  const fenceRe =
    /```(warp-action|warp-diff|warp-todos|warp-status)[ \t]*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const kind = m[1];
    const body = m[2].trim();
    let label = kind
      .replace("warp-", "")
      .replace(/-/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
    let meta: string | undefined;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed.summary === "string") label = parsed.summary;
      if (typeof parsed.path === "string") meta = parsed.path;
    } catch {
      /* keep kind-derived label */
    }
    const id = `fence-${m.index}`;
    if (!seen.has(id)) {
      seen.add(id);
      found.push({ id, label, ...(meta ? { meta } : {}) });
    }
  }

  // 2. ACTION: / TOOL: lines
  const lineRe = /^(?:ACTION|TOOL):\s*(.+)/i;
  text.split("\n").forEach((line, i) => {
    const lm = lineRe.exec(line.trim());
    if (!lm) return;
    const label = lm[1].trim();
    const id = `line-${i}`;
    if (!seen.has(id)) {
      seen.add(id);
      found.push({ id, label });
    }
  });

  // 3. HTML comment markers emitted by CMD extractors
  if (/<!--\s*ISSUE_DRAFT:\s*true\s*-->/i.test(text)) {
    const id = "issue-draft";
    if (!seen.has(id)) {
      seen.add(id);
      found.push({ id, label: "Drafting issue" });
    }
  }
  if (/<!--\s*PR_ACTION/i.test(text)) {
    const id = "pr-action";
    if (!seen.has(id)) {
      seen.add(id);
      found.push({ id, label: "PR action" });
    }
  }

  return found;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

type Input = {
  streaming: boolean;
  streamingText: string;
};

type Result = {
  /** Items to display. Empty list = panel shows "Waiting…" placeholder. */
  items: ActivityItem[];
  /** Seconds elapsed since streaming began. */
  elapsedSeconds: number;
  /** Whether the panel should be mounted (true while streaming + 1.5s after). */
  visible: boolean;
};

/**
 * Drives the ActivityPanel lifecycle:
 *
 *   - `visible` goes true as soon as streaming starts, stays true for 1.5s
 *     after streaming ends so the panel has time to show the final state.
 *   - The elapsed-seconds timer runs every 1 000 ms while streaming.
 *   - `items` is computed live from `streamingText` while streaming.
 *     When streaming ends, the final list is frozen (all rows marked "done")
 *     so the panel doesn't blank out before the dismiss timeout fires.
 */
export function useActivityPanel({ streaming, streamingText }: Input): Result {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [visible, setVisible] = useState(false);
  const [frozenItems, setFrozenItems] = useState<ActivityItem[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Live items derived from the current streamingText.
  // The last item in the list is "active" while streaming is true.
  const liveItems = useMemo<ActivityItem[]>(() => {
    if (!streamingText) return [];
    const raw = extractRawItems(streamingText);
    return raw.map((item, i) => ({
      ...item,
      state: streaming && i === raw.length - 1 ? "active" : "done",
    }));
  }, [streamingText, streaming]);

  // Keep a ref so the cleanup closure can read the latest liveItems without
  // listing them as an effect dependency (which would re-run every text chunk).
  const liveItemsRef = useRef<ActivityItem[]>(liveItems);
  liveItemsRef.current = liveItems;

  useEffect(() => {
    if (streaming) {
      // Cancel any pending dismiss from a previous stream.
      if (dismissRef.current) {
        clearTimeout(dismissRef.current);
        dismissRef.current = null;
      }

      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      setFrozenItems([]);
      setVisible(true);

      intervalRef.current = setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsedSeconds(
            Math.floor((Date.now() - startTimeRef.current) / 1000),
          );
        }
      }, 1000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    } else {
      // Streaming just ended (or was never started on first render).
      if (startTimeRef.current !== null) {
        // Freeze the items so they stay visible during the dismiss window.
        setFrozenItems(
          liveItemsRef.current.map((item) => ({ ...item, state: "done" })),
        );
        dismissRef.current = setTimeout(() => {
          setVisible(false);
          startTimeRef.current = null;
        }, 1500);
      }
    }
  }, [streaming]);

  // Full cleanup on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, []);

  const items = streaming ? liveItems : frozenItems;

  return { items, elapsedSeconds, visible };
}
