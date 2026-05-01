"use client";

/**
 * Phase 3.5 — Inline structured "task complete" summary card.
 *
 * Rendered when the assistant message contains a well-formed
 * `<!-- TASK_COMPLETE: {json} -->` marker (parsed by
 * `extractTaskComplete` in `src/lib/task-complete-extract.ts`). Replaces
 * the operator's need to scan prose for "did the task actually
 * succeed?" with a structured outcome panel.
 *
 * Variants:
 *   issue_created            → Issue #N + GitHub link, [Open in GitHub] [New directive]
 *   pr_merged                → PR #N + branch + commit, [Open in GitHub] [Post-merge sync]
 *   pr_closed                → PR #N + reason, [Open in GitHub]
 *   pr_held                  → PR #N + reason, [View PR]               (warn tone — amber)
 *   constitution_refreshed   → N files updated + last sync time, no actions
 *   generic                  → CMD summary, [New directive]
 *
 * Visual style intentionally matches `IssueCard` and `PRCard`:
 *   bg-elev-1, border-soft, rounded-md, 2px left border (teal for
 *   success, amber for hold/warn). No new design tokens.
 *
 * The [New directive] / [Post-merge sync] buttons need to surface up
 * to ChatArea (which owns `onNewDirective`). Rather than prop-drill
 * through MessageBubble → MessageContent → here, the card dispatches
 * a `CustomEvent('warp:new-directive', { detail: { prefill? } })` on
 * window. ChatArea attaches a listener and acts on it. This keeps
 * the rendered-message pipeline pure (no extra props on every
 * MessageContent call) and matches React's "leaf widget calls global
 * intent" pattern used elsewhere for keyboard insets.
 */

import type { TaskCompletePayload } from "@/lib/task-complete-extract";

type Props = {
  payload: TaskCompletePayload;
};

type Tone = "success" | "warn";

const PR_BASE = "https://github.com/bayuewalker/walkermind-os/pull/";

export default function TaskCompleteCard({ payload }: Props) {
  const view = renderForKind(payload);
  const accent = view.tone === "warn" ? "var(--warp-amber)" : "var(--warp-teal)";
  const headColor =
    view.tone === "warn" ? "text-warp-amber" : "text-warp-teal";

  return (
    <div
      className="my-3 rounded-md overflow-hidden"
      style={{
        background: "var(--bg-elev-1)",
        border: "1px solid var(--border-soft)",
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-hair gap-2">
        <div
          className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] ${headColor} min-w-0`}
        >
          <span aria-hidden="true">{view.tone === "warn" ? "⏸" : "✓"}</span>
          <span className="truncate">{view.title}</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/55 shrink-0">
          WARP•CMD
        </span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        {view.body && (
          <div className="text-[13px] text-white/90 leading-snug">
            {view.body}
          </div>
        )}
        {view.subtitle && (
          <div className="text-[11px] text-white/55 leading-relaxed">
            {view.subtitle}
          </div>
        )}
        {view.link && (
          <div className="text-[11px] font-mono text-warp-blue break-all">
            {stripUrlScheme(view.link)}
          </div>
        )}
        {view.actions.length > 0 && (
          <div className="pt-1 flex flex-wrap gap-2">
            {view.actions.map((a) =>
              a.kind === "link" ? (
                <a
                  key={a.label}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/85 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <span>{a.label}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => emitNewDirective(a.prefill)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-warp-teal/50 bg-warp-teal-bg text-warp-teal hover:bg-warp-teal/15 transition-colors"
                >
                  <span>{a.label}</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type Action =
  | { kind: "link"; label: string; href: string }
  | { kind: "new-directive"; label: string; prefill?: string };

type View = {
  tone: Tone;
  title: string;
  body: string | null;
  subtitle: string | null;
  link: string | null;
  actions: Action[];
};

function renderForKind(p: TaskCompletePayload): View {
  switch (p.kind) {
    case "issue_created":
      return {
        tone: "success",
        title: `Issue #${p.issue.number} created`,
        body: p.issue.title,
        subtitle: "Next: WARP•FORGE ready for dispatch",
        link: p.issue.url,
        actions: [
          { kind: "link", label: "Open in GitHub", href: p.issue.url },
          { kind: "new-directive", label: "New directive" },
        ],
      };
    case "pr_merged": {
      const url = p.pr.url ?? `${PR_BASE}${p.pr.number}`;
      const bodyParts: string[] = [];
      if (p.pr.branch) bodyParts.push(`Branch: ${p.pr.branch}`);
      if (p.pr.mergeCommit)
        bodyParts.push(`Merge commit: ${p.pr.mergeCommit.slice(0, 12)}`);
      return {
        tone: "success",
        title: `PR #${p.pr.number} merged`,
        body: bodyParts.length > 0 ? bodyParts.join(" · ") : null,
        subtitle: "Post-merge sync required",
        link: url,
        actions: [
          { kind: "link", label: "Open in GitHub", href: url },
          {
            kind: "new-directive",
            label: "Post-merge sync ▶",
            prefill: p.pr.branch
              ? `post-merge sync for ${p.pr.branch}: update PROJECT_STATE.md, ROADMAP.md, WORKTODO.md, CHANGELOG.md`
              : `post-merge sync for PR #${p.pr.number}: update PROJECT_STATE.md, ROADMAP.md, WORKTODO.md, CHANGELOG.md`,
          },
        ],
      };
    }
    case "pr_closed": {
      const url = p.pr.url ?? `${PR_BASE}${p.pr.number}`;
      return {
        tone: "success",
        title: `PR #${p.pr.number} closed`,
        body: p.pr.reason ?? null,
        subtitle: null,
        link: url,
        actions: [{ kind: "link", label: "Open in GitHub", href: url }],
      };
    }
    case "pr_held": {
      const url = p.pr.url ?? `${PR_BASE}${p.pr.number}`;
      return {
        tone: "warn",
        title: `PR #${p.pr.number} held`,
        body: p.pr.reason ?? null,
        subtitle: null,
        link: url,
        actions: [{ kind: "link", label: "View PR", href: url }],
      };
    }
    case "constitution_refreshed": {
      const ts = p.refresh.lastSyncIso
        ? formatLocalTime(p.refresh.lastSyncIso)
        : null;
      const body = `${p.refresh.filesUpdated} file${
        p.refresh.filesUpdated === 1 ? "" : "s"
      } updated${ts ? ` · last sync ${ts}` : ""}`;
      return {
        tone: "success",
        title: "Constitution refreshed",
        body,
        subtitle: null,
        link: null,
        actions: [],
      };
    }
    case "generic":
      return {
        tone: "success",
        title: "Task complete",
        body: p.summary,
        subtitle: null,
        link: null,
        actions: [{ kind: "new-directive", label: "New directive" }],
      };
  }
}

function stripUrlScheme(u: string): string {
  return u.replace(/^https?:\/\//, "");
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function emitNewDirective(prefill?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("warp:new-directive", {
      detail: prefill ? { prefill } : undefined,
    }),
  );
}
