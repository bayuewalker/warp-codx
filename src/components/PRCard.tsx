"use client";

/**
 * Phase 3c — Inline PR card rendered when CMD emits
 *   <!-- PR_ACTION: detail:N -->,
 *   <!-- PR_ACTION: merge:N -->, or
 *   <!-- PR_ACTION: close:N -->.
 *
 * Lifecycle states:
 *   loading       → fetching `/api/prs/[number]`
 *   error         → fetch failed (sanitized message + retry)
 *   collapsed     → default for `detail:N`
 *   expanded      → default for `merge:N` / `close:N`; gates checklist + actions
 *   confirmingClose → user tapped CLOSE; reason textarea visible
 *   submitting    → POST in flight
 *   merged        → post-merge success state with reminder line
 *   closed        → post-close success state
 *   held          → 409 HOLD response with blockers list
 *
 * The card NEVER mutates the persisted assistant message — discard /
 * edit / action result only affect local UI state. The post-merge
 * reminder line CMD prints in its prose is already part of the
 * persisted message; the card only echoes it as a reminder.
 *
 * Visual: bg-elev-1, border-soft, rounded-md, 2px purple left border
 * (`var(--warp-purple)`). Status colors: teal=merged, red=closed,
 * amber=hold, blue=open. No new design tokens.
 */

import { useEffect, useState } from "react";
import { prsFetch } from "@/lib/prs-fetch";
import type { GateResult } from "@/lib/pr-gates";

export type PRInitialIntent = "detail" | "merge" | "close" | "hold";

type Props = {
  prNumber: number;
  initialIntent: PRInitialIntent;
  sessionId: string | null;
  /**
   * Phase 3.5 polish — when `true` the card renders as a flush-mounted
   * continuation of an outer container (e.g. a `PRListCard` row) rather
   * than as a fully-chromed standalone card. Specifically: skip the
   * outer `my-3 rounded-md border` wrapper and the WARP•CMD-badged
   * `Header` (the parent row already shows `#N · state · title`), and
   * skip the duplicate title line in the expanded body. The status
   * change branches (merged/closed/held) still drop their full chrome
   * — the colored left-border and header label vanish too — because
   * the parent list row owns the visual identity. Default is `false`
   * to preserve the original standalone behavior used by the chat
   * surface (`<!-- PR_ACTION: detail:N -->` mounts).
   */
  embedded?: boolean;
};

type PRDetail = {
  number: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  author: string;
  state: "open" | "closed" | "merged";
  merged: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  updatedAt: string;
  createdAt: string;
  url: string;
  reviews: Array<{
    id: number;
    user: string;
    state: string;
    body: string;
    submittedAt: string | null;
  }>;
};

type DetailResponse = {
  pr: PRDetail;
  gates: GateResult;
  postMergeReminder: string;
};

type CardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "collapsed"; data: DetailResponse }
  | { kind: "expanded"; data: DetailResponse; primary: PRInitialIntent }
  | { kind: "confirmingClose"; data: DetailResponse }
  | { kind: "confirmingHold"; data: DetailResponse }
  | {
      kind: "submitting";
      data: DetailResponse;
      op: "merge" | "close" | "hold";
    }
  | {
      kind: "merged";
      data: DetailResponse;
      sha: string;
      postMergeReminder: string;
    }
  | { kind: "closed"; data: DetailResponse; reason: string }
  | {
      kind: "held";
      data: DetailResponse;
      blockers: string[];
      /** True for operator-tapped HOLD; false (or absent) for gate-blocked HOLD. */
      manual?: boolean;
    };

export default function PRCard({
  prNumber,
  initialIntent,
  sessionId,
  embedded = false,
}: Props) {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [closeReason, setCloseReason] = useState("");
  const [holdReason, setHoldReason] = useState("");

  // Initial fetch — also re-runs on retry from error state.
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const res = await prsFetch(`/api/prs/${prNumber}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | DetailResponse
        | { error?: string }
        | null;
      if (!res.ok || !json || !("pr" in json)) {
        const message =
          json && "error" in json && json.error
            ? json.error
            : `Failed to load PR (HTTP ${res.status})`;
        setState({ kind: "error", message });
        return;
      }
      // Marker → initial state mapping:
      //   detail:N            → collapsed (read-only inspection)
      //   merge:N             → expanded with merge as primary visual cue
      //                         (merge button stays user-tap; never auto-fires)
      //   close:N             → expanded AND auto-open the close-confirmation
      //                         textarea so the user just types the reason
      //   hold:N              → expanded AND auto-open the hold-confirmation
      //                         textarea so the user just types the reason
      // The merge button is intentionally NOT auto-confirmed — gates re-run
      // server-side and the user must tap MERGE explicitly.
      if (initialIntent === "detail") {
        setState({ kind: "collapsed", data: json });
      } else if (initialIntent === "close") {
        setState({ kind: "confirmingClose", data: json });
      } else if (initialIntent === "hold") {
        setState({ kind: "confirmingHold", data: json });
      } else {
        setState({
          kind: "expanded",
          data: json,
          primary: initialIntent,
        });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "network error",
      });
    }
  };

  useEffect(() => {
    void load();
    // Intentionally only on mount + when prNumber/initialIntent change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prNumber, initialIntent]);

  // Wrapper for action POST calls.
  const handleMerge = async () => {
    if (state.kind !== "expanded") return;
    const prevData = state.data;
    setState({ kind: "submitting", data: prevData, op: "merge" });
    try {
      const res = await prsFetch(`/api/prs/${prNumber}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            merged?: boolean;
            sha?: string;
            postMergeReminder?: string;
            status?: string;
            blockers?: string[];
            error?: string;
          }
        | null;

      if (res.status === 409 && json?.status === "HOLD") {
        setState({
          kind: "held",
          data: prevData,
          blockers: json.blockers ?? ["Gate blocked"],
        });
        return;
      }
      if (!res.ok || !json?.merged || !json.sha) {
        setState({
          kind: "error",
          message: json?.error ?? `Merge failed (HTTP ${res.status})`,
        });
        return;
      }
      setState({
        kind: "merged",
        data: prevData,
        sha: json.sha,
        postMergeReminder:
          json.postMergeReminder ?? prevData.postMergeReminder,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "network error",
      });
    }
  };

  const handleHold = async () => {
    // Reason check first so an empty-reason early return is
    // unambiguous in the console log below.
    const reason = holdReason.trim();
    if (reason.length === 0) {
      console.warn(
        `[PRCard #${prNumber}] handleHold: empty reason, ignoring tap`,
      );
      return;
    }
    if (state.kind !== "confirmingHold") {
      console.warn(
        `[PRCard #${prNumber}] handleHold: state is ${state.kind}, not confirmingHold — ignoring tap`,
      );
      return;
    }
    const prevData = state.data;
    setState({ kind: "submitting", data: prevData, op: "hold" });

    console.log(
      `[PRCard #${prNumber}] handleHold → POST /api/prs/${prNumber}/hold`,
    );
    try {
      const res = await prsFetch(`/api/prs/${prNumber}/hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reason }),
      });
      const json = (await res.json().catch(() => null)) as
        | { held?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.held) {
        const message = json?.error ?? `Hold failed (HTTP ${res.status})`;
        console.error(`[PRCard #${prNumber}] handleHold failed: ${message}`);
        setState({ kind: "error", message });
        return;
      }
      // Re-render in the existing HELD state with the operator's
      // reason as the sole "blocker" entry. `manual: true` switches
      // the card label so it's distinguishable from a gate-blocked HOLD.
      setState({
        kind: "held",
        data: prevData,
        blockers: [reason],
        manual: true,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "network error";
      console.error(`[PRCard #${prNumber}] handleHold threw: ${message}`);
      setState({ kind: "error", message });
    }
  };

  const handleClose = async () => {
    // FIX (bug report May 2026): "Tap CONFIRM CLOSE × → nothing
    // happens (no API call, no card state change)". The wiring was
    // already in place but the handler was failing silently in two
    // possible ways that produced the reported symptom:
    //   1. An empty (or whitespace-only) `closeReason` would early
    //      return WITHOUT logging anything, indistinguishable from
    //      "the click didn't fire".
    //   2. A stale-closure `state.kind !== "confirmingClose"` guard
    //      would early return WITHOUT logging anything, also
    //      indistinguishable from "the click didn't fire".
    // We now (a) move the reason check first so the diagnostics are
    // unambiguous, (b) log every early-return path so the operator
    // can see in DevTools console exactly why the tap was ignored,
    // (c) log every failure path so a 4xx/5xx from the server is
    // visible, and (d) log the success path so a working close is
    // also visible.
    const reason = closeReason.trim();
    if (reason.length === 0) {
      console.warn(
        `[PRCard #${prNumber}] handleClose: empty reason, ignoring tap`,
      );
      return;
    }
    if (state.kind !== "confirmingClose") {
      console.warn(
        `[PRCard #${prNumber}] handleClose: state is ${state.kind}, not confirmingClose — ignoring tap`,
      );
      return;
    }
    const prevData = state.data;
    setState({ kind: "submitting", data: prevData, op: "close" });

    console.log(
      `[PRCard #${prNumber}] handleClose → POST /api/prs/${prNumber}/close`,
    );
    try {
      const res = await prsFetch(`/api/prs/${prNumber}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reason }),
      });
      const json = (await res.json().catch(() => null)) as
        | { closed?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.closed) {
        const message = json?.error ?? `Close failed (HTTP ${res.status})`;
        console.error(`[PRCard #${prNumber}] handleClose failed: ${message}`);
        setState({ kind: "error", message });
        return;
      }
      console.log(
        `[PRCard #${prNumber}] handleClose succeeded — transitioning to closed state`,
      );
      setState({ kind: "closed", data: prevData, reason });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "network error";
      console.error(`[PRCard #${prNumber}] handleClose threw: ${message}`);
      setState({ kind: "error", message });
    }
  };

  // ─── Render branches ────────────────────────────────────────────

  if (state.kind === "loading") {
    return (
      <CardShell prNumber={prNumber} embedded={embedded}>
        <div className="px-4 py-3 text-[12px] text-white/50">
          Loading PR #{prNumber}…
        </div>
      </CardShell>
    );
  }

  if (state.kind === "error") {
    return (
      <CardShell prNumber={prNumber} embedded={embedded}>
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-warp-amber/90">
            PR action failed
          </div>
          <div className="text-[12px] text-white/80 leading-relaxed break-words">
            {state.message}
          </div>
          <div>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  if (state.kind === "merged") {
    return (
      <CardShell prNumber={prNumber} accent="teal" embedded={embedded}>
        {!embedded && (
          <Header
            prNumber={state.data.pr.number}
            status="MERGED"
            statusAccent="teal"
          />
        )}
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="text-[13px] text-white/90 leading-snug">
            {state.data.pr.title}
          </div>
          <div className="text-[11px] text-white/55">
            Merged by WARP🔹CMD via WARP CodX · sha{" "}
            <span className="font-mono text-warp-blue">
              {state.sha.slice(0, 7)}
            </span>
          </div>
          <div className="text-[11px] text-white/65 leading-relaxed pt-1 border-t border-hair pt-2 mt-1">
            {state.postMergeReminder}
          </div>
          <div className="pt-1">
            <ExternalLink href={state.data.pr.url} label="Open in GitHub" />
          </div>
        </div>
      </CardShell>
    );
  }

  if (state.kind === "closed") {
    return (
      <CardShell prNumber={prNumber} accent="red" embedded={embedded}>
        {!embedded && (
          <Header
            prNumber={state.data.pr.number}
            status="CLOSED"
            statusAccent="amber"
          />
        )}
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="text-[13px] text-white/90 leading-snug">
            {state.data.pr.title}
          </div>
          <div className="text-[11px] text-white/55">Reason</div>
          <div className="text-[12px] text-white/80 leading-relaxed">
            {state.reason}
          </div>
          <div className="pt-1">
            <ExternalLink href={state.data.pr.url} label="Open in GitHub" />
          </div>
        </div>
      </CardShell>
    );
  }

  if (state.kind === "held") {
    const heldStatus = state.manual ? "HELD · MANUAL" : "HELD";
    const subLabel = state.manual
      ? "Manual hold — operator-tapped"
      : "Pre-merge gate blocked";
    return (
      <CardShell prNumber={prNumber} accent="amber" embedded={embedded}>
        {!embedded && (
          <Header
            prNumber={state.data.pr.number}
            status={heldStatus}
            statusAccent="amber"
          />
        )}
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="text-[13px] text-white/90 leading-snug">
            {state.data.pr.title}
          </div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-warp-amber/90">
            {subLabel}
          </div>
          <ul className="text-[12px] text-white/80 leading-relaxed list-disc pl-5">
            {state.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <div className="pt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors"
            >
              Refresh
            </button>
            <ExternalLink href={state.data.pr.url} label="Open in GitHub" />
          </div>
        </div>
      </CardShell>
    );
  }

  // collapsed | expanded | confirmingClose | confirmingHold | submitting
  // share the same shell.
  const data =
    state.kind === "collapsed" ||
    state.kind === "expanded" ||
    state.kind === "confirmingClose" ||
    state.kind === "confirmingHold" ||
    state.kind === "submitting"
      ? state.data
      : null;

  if (!data) return null;

  const pr = data.pr;
  const gates = data.gates;
  const isExpanded =
    state.kind !== "collapsed" && state.kind !== "submitting"
      ? true
      : state.kind === "submitting";
  const submittingOp = state.kind === "submitting" ? state.op : null;
  const inConfirmClose = state.kind === "confirmingClose";
  const inConfirmHold = state.kind === "confirmingHold";

  return (
    <CardShell prNumber={pr.number} embedded={embedded}>
      {!embedded && (
        <Header
          prNumber={pr.number}
          status={stateLabel(pr.state)}
          statusAccent={accentForState(pr.state)}
        />
      )}
      <div className="px-4 py-4 flex flex-col gap-3">
        {!embedded && (
          <div className="text-[13px] text-white/90 leading-snug">
            {pr.title}
          </div>
        )}
        <MetaRow pr={pr} tier={gates.tier} />

        {!isExpanded && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() =>
                setState({
                  kind: "expanded",
                  data,
                  primary: "merge",
                })
              }
              className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/75 hover:text-white hover:bg-white/5 transition-colors"
            >
              View details ›
            </button>
          </div>
        )}

        {isExpanded && (
          <>
            <div className="pt-1 flex flex-col gap-1 text-[12px] text-white/80">
              <DetailRow label="Branch">
                <span className="font-mono text-warp-blue">{pr.branch}</span>{" "}
                <span className="text-white/35">→ {pr.baseBranch}</span>
              </DetailRow>
              <DetailRow label="Author">
                <span className="font-mono text-white/75">@{pr.author}</span>
              </DetailRow>
              <DetailRow label="Tier">
                <span className="text-white/85">
                  {gates.tier ?? "—"}
                </span>
              </DetailRow>
              <DetailRow label="Reviews">
                <ReviewsSummary reviews={pr.reviews} />
              </DetailRow>
            </div>

            <div className="pt-2 mt-1 border-t border-hair">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 mb-1.5">
                Pre-merge checks
              </div>
              <ul className="flex flex-col gap-0.5 text-[12px]">
                <GateRow
                  ok={gates.gates.tierDeclared}
                  label="Validation Tier declared"
                />
                <GateRow
                  ok={gates.gates.claimDeclared}
                  label="Claim Level declared"
                />
                <GateRow
                  ok={gates.gates.targetDeclared}
                  label="Validation Target declared"
                />
                <GateRow
                  ok={gates.gates.notInScopeDeclared}
                  label="Not in Scope declared"
                />
                <GateRow
                  ok={gates.gates.branchFormat}
                  label={`Branch starts with WARP/`}
                />
                <GateRow
                  ok={gates.gates.forgeOutputComplete}
                  label="WARP•FORGE output: Report: + State: lines"
                />
                <GateRow
                  ok={gates.gates.ciPassed}
                  label={ciGateLabel(gates.ciStatus)}
                />
                {gates.tier === "MAJOR" && (
                  <GateRow
                    ok={gates.gates.sentinelApproved}
                    label="MAJOR — SENTINEL APPROVED / CONDITIONAL"
                  />
                )}
                {gates.isSentinel && (
                  <GateRow
                    ok={gates.gates.forgeMerged}
                    label="WARP•SENTINEL — paired WARP•FORGE PR merged"
                  />
                )}
              </ul>
              {!gates.ok && gates.blockers.length > 0 && (
                <div className="mt-2 text-[11px] text-warp-amber/80 leading-relaxed">
                  {gates.blockers.length} blocker
                  {gates.blockers.length === 1 ? "" : "s"} — server will
                  refuse merge until resolved.
                </div>
              )}
            </div>

            {inConfirmClose && (
              <div className="pt-2 flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                  Close reason (required)
                </label>
                <textarea
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. duplicate of #41, scope creep, abandoned…"
                  className="w-full bg-transparent border border-hair rounded px-2 py-1.5 text-[12px] text-white/90 focus:outline-none focus:border-warp-amber/60"
                />
                {/* Visible hint so an "ignored tap" on the disabled
                    Confirm button is never mysterious. Renders only
                    when the trimmed reason is empty (which is exactly
                    when the button is disabled). */}
                {closeReason.trim().length === 0 && (
                  <div className="text-[10px] text-white/45">
                    Enter a reason to enable Confirm close.
                  </div>
                )}
              </div>
            )}

            {inConfirmHold && (
              <div className="pt-2 flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                  Hold reason (required) — PR stays open on GitHub
                </label>
                <textarea
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. waiting on SENTINEL audit, paired FORGE not yet merged…"
                  className="w-full bg-transparent border border-hair rounded px-2 py-1.5 text-[12px] text-white/90 focus:outline-none focus:border-warp-amber/60"
                />
                {/* Visible hint so an "ignored tap" on the disabled
                    Confirm button is never mysterious. Renders only
                    when the trimmed reason is empty (which is exactly
                    when the button is disabled). */}
                {holdReason.trim().length === 0 && (
                  <div className="text-[10px] text-white/45">
                    Enter a reason to enable Confirm hold.
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 flex flex-col gap-1.5">
              {inConfirmClose ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() =>
                      setState({ kind: "expanded", data, primary: "close" })
                    }
                    disabled={!!submittingOp}
                    className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClose()}
                    disabled={
                      !!submittingOp || closeReason.trim().length === 0
                    }
                    className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-warp-amber/50 bg-warp-amber/10 text-warp-amber hover:bg-warp-amber/20 transition-colors disabled:opacity-40"
                  >
                    {submittingOp === "close"
                      ? "Closing…"
                      : "Confirm close ✕"}
                  </button>
                </div>
              ) : inConfirmHold ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() =>
                      setState({ kind: "expanded", data, primary: "hold" })
                    }
                    disabled={!!submittingOp}
                    className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleHold()}
                    disabled={
                      !!submittingOp || holdReason.trim().length === 0
                    }
                    className="px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-warp-amber/50 bg-warp-amber/10 text-warp-amber hover:bg-warp-amber/20 transition-colors disabled:opacity-40"
                  >
                    {submittingOp === "hold"
                      ? "Holding…"
                      : "Confirm hold ⏸"}
                  </button>
                </div>
              ) : (
                <>
                  {/* Phase 3.5 polish — two-row layout. Row 1 groups
                      the three secondary/destructive actions in equal
                      thirds; Row 2 promotes Merge to a full-width
                      primary action. Colors and hover states are
                      preserved verbatim from the original single-row
                      cluster — only the wrapper structure changed. */}
                  <div className="w-full flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() => void load()}
                      disabled={!!submittingOp}
                      className="flex-1 basis-0 min-w-0 px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/55 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setState({ kind: "confirmingClose", data })
                      }
                      disabled={!!submittingOp || pr.state !== "open"}
                      className="flex-1 basis-0 min-w-0 px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-warp-amber hover:border-warp-amber/40 transition-colors disabled:opacity-40"
                    >
                      Close ×
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setState({ kind: "confirmingHold", data })
                      }
                      disabled={!!submittingOp || pr.state !== "open"}
                      title="Manual hold — posts a comment, leaves PR open on GitHub"
                      className="flex-1 basis-0 min-w-0 px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-warp-amber hover:border-warp-amber/40 transition-colors disabled:opacity-40"
                    >
                      Hold ⏸
                    </button>
                  </div>
                  {(() => {
                    const mergeBlocked =
                      !gates.ok &&
                      pr.state === "open" &&
                      !submittingOp;
                    const blockerCount = gates.blockers.length;
                    return (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={
                            mergeBlocked
                              ? undefined
                              : () => void handleMerge()
                          }
                          disabled={
                            !!submittingOp ||
                            !gates.ok ||
                            pr.state !== "open"
                          }
                          title={
                            gates.ok
                              ? "Squash-merge with canonical commit title"
                              : `Gate blocked — ${blockerCount} blocker${blockerCount === 1 ? "" : "s"} must be resolved`
                          }
                          className={`w-full px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border transition-colors${
                            mergeBlocked
                              ? " border-warp-amber/50 bg-warp-amber/5 text-warp-amber opacity-40 cursor-not-allowed pointer-events-none"
                              : " border-warp-teal/50 bg-warp-teal-bg text-warp-teal hover:bg-warp-teal/15 disabled:opacity-40 disabled:cursor-not-allowed"
                          }`}
                        >
                          {submittingOp === "merge"
                            ? "Merging…"
                            : mergeBlocked
                              ? "MERGE BLOCKED"
                              : "Merge ✓"}
                        </button>
                        {mergeBlocked && blockerCount > 0 && (
                          <div className="text-[10px] text-warp-amber/70 text-center leading-tight">
                            {blockerCount} blocker
                            {blockerCount === 1 ? "" : "s"} must be resolved
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </CardShell>
  );
}

// ─── shared chrome ──────────────────────────────────────────────────

function CardShell({
  prNumber,
  accent = "purple",
  embedded = false,
  children,
}: {
  prNumber: number;
  accent?: "purple" | "teal" | "red" | "amber";
  embedded?: boolean;
  children: React.ReactNode;
}) {
  // Embedded mode renders flush inside an outer container (e.g. a
  // `PRListCard` row) — no border, no margin, no background — so the
  // content reads as a continuation of the parent row rather than a
  // visually-separate "duplicate" card. The accent color is dropped
  // along with the border because there's nothing to color.
  if (embedded) {
    return (
      <div data-pr-number={prNumber}>
        {children}
      </div>
    );
  }

  const borderColor =
    accent === "teal"
      ? "var(--warp-teal)"
      : accent === "red"
        ? "var(--warp-red, #f87171)"
        : accent === "amber"
          ? "var(--warp-amber)"
          : "var(--warp-purple)";
  return (
    <div
      className="my-3 rounded-md overflow-hidden"
      style={{
        background: "var(--bg-elev-1)",
        border: "1px solid var(--border-soft)",
        borderLeft: `2px solid ${borderColor}`,
      }}
      data-pr-number={prNumber}
    >
      {children}
    </div>
  );
}

function Header({
  prNumber,
  status,
  statusAccent,
}: {
  prNumber: number;
  status: string;
  statusAccent: "purple" | "teal" | "red" | "amber" | "blue";
}) {
  // Status pill colors. Mirrors the left-border accent so the card
  // reads as a single coherent visual unit at a glance: teal=merged,
  // amber=closed/held, blue=open, red=hard-error, purple=loading.
  const pillCls =
    statusAccent === "teal"
      ? "border-warp-teal/40 bg-warp-teal/15 text-warp-teal"
      : statusAccent === "amber"
        ? "border-warp-amber/40 bg-warp-amber/15 text-warp-amber"
        : statusAccent === "red"
          ? "border-warp-red/50 bg-warp-red/15 text-warp-red"
          : statusAccent === "blue"
            ? "border-warp-blue/40 bg-warp-blue/15 text-warp-blue"
            : "border-warp-purple/40 bg-warp-purple/15 text-warp-purple";
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-hair">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[12px] tracking-[0.06em] text-white/85">
          PR #{prNumber}
        </span>
        <span
          className={`px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-[0.14em] ${pillCls}`}
        >
          {status}
        </span>
      </div>
      <span className="agent-pill cmd">WARP•CMD</span>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/45 w-16 shrink-0">
        {label}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

/**
 * Task #30 — turn the resolved CI status from the server into the row
 * label shown under "Pre-merge checks". When the server didn't pass a
 * status (`null`) we still show a helpful row so the operator can tell
 * the gate is N/A vs blocking.
 */
function ciGateLabel(status: GateResult["ciStatus"]): string {
  if (status === "success") return "CI: npm test green on head SHA";
  if (status === "failure") return "CI: npm test failing on head SHA";
  if (status === "pending") return "CI: test job still running";
  if (status === "missing")
    return "CI: no `test` check run on head SHA yet";
  return "CI: status unavailable (gate skipped)";
}

function GateRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={ok ? "text-warp-teal" : "text-warp-amber"}
      >
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-white/80" : "text-warp-amber/90"}>
        {label}
      </span>
    </li>
  );
}

function MetaRow({
  pr,
  tier,
}: {
  pr: PRDetail;
  tier: GateResult["tier"];
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-white/55 flex-wrap">
      <span className="font-mono text-warp-blue">{pr.branch}</span>
      {tier && (
        <span className="px-1.5 py-[1px] rounded border border-hair text-[9px] uppercase tracking-[0.18em] text-white/65">
          {tier}
        </span>
      )}
      {pr.additions > 0 || pr.deletions > 0 ? (
        <span className="font-mono text-white/65">
          +{pr.additions} −{pr.deletions}
        </span>
      ) : null}
      <span className="font-mono">{formatRelative(pr.updatedAt)}</span>
    </div>
  );
}

function ReviewsSummary({
  reviews,
}: {
  reviews: PRDetail["reviews"];
}) {
  if (reviews.length === 0)
    return <span className="text-white/45">No reviews</span>;
  const counts: Record<string, number> = {};
  for (const r of reviews) counts[r.state] = (counts[r.state] ?? 0) + 1;
  const parts = Object.entries(counts).map(
    ([state, n]) => `${n} ${state.toLowerCase()}`,
  );
  return <span className="text-white/75">{parts.join(", ")}</span>;
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-[12px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/85 hover:text-white hover:bg-white/5 transition-colors"
    >
      <span>{label}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

function stateLabel(s: "open" | "closed" | "merged"): string {
  if (s === "merged") return "MERGED";
  if (s === "closed") return "CLOSED";
  return "OPEN";
}

function accentForState(
  s: "open" | "closed" | "merged",
): "blue" | "amber" | "teal" {
  if (s === "merged") return "teal";
  if (s === "closed") return "amber";
  return "blue";
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}
