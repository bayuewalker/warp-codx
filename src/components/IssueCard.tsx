"use client";

/**
 * Phase 3b — Inline preview card rendered when CMD emits an
 * `<!-- ISSUE_DRAFT: true -->` marker in its assistant turn.
 *
 * Lifecycle states:
 *   draft     → initial; populated from the JSON sidecar emitted by CMD
 *   editing   → user tapped EDIT; title / branch slug / tier are inputs
 *   creating  → POST /api/issues/create in flight
 *   created   → success; shows issue # + GitHub link + OPEN button
 *   error     → server returned non-200; shows sanitized message + retry
 *   discarded → user tapped DISCARD; card is hidden (markdown body
 *               in the persisted message remains untouched)
 *
 * The card never mutates the persisted assistant message — discard /
 * edit only affect local UI state. The body sent to GitHub is the
 * (possibly edited) `body` field; original COMMANDER.md formatting is
 * preserved unless the user edits it explicitly.
 *
 * Visual style: matches the existing card primitives (bg-elev-1,
 * border-soft, rounded-md, 2px teal left-border to echo agent-pill.forge).
 * No new design tokens are introduced.
 */

import { useState } from "react";
import { issuesFetch } from "@/lib/issues-fetch";

export type IssueDraftData = {
  title: string;
  branchSlug: string;
  validationTier: "MINOR" | "STANDARD" | "MAJOR";
  objective: string;
  /** Full markdown body sent verbatim to GitHub. */
  body: string;
};

type Props = {
  data: IssueDraftData;
  sessionId: string | null;
};

type State =
  | { kind: "draft" }
  | { kind: "editing" }
  | { kind: "creating" }
  | { kind: "created"; issueNumber: number; issueUrl: string; title: string }
  | { kind: "error"; message: string };

const TIERS: Array<IssueDraftData["validationTier"]> = [
  "MINOR",
  "STANDARD",
  "MAJOR",
];

export default function IssueCard({ data, sessionId }: Props) {
  const [state, setState] = useState<State>({ kind: "draft" });
  const [discarded, setDiscarded] = useState(false);
  const [draft, setDraft] = useState<IssueDraftData>(data);

  if (discarded) return null;

  // ─── CREATED state ──────────────────────────────────────────────
  if (state.kind === "created") {
    return (
      <div
        className="my-3 rounded-md overflow-hidden"
        style={{
          background: "var(--bg-elev-1)",
          border: "1px solid var(--border-soft)",
          borderLeft: "2px solid var(--warp-teal)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-hair">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-warp-teal">
            <span aria-hidden="true">✓</span>
            <span>Issue #{state.issueNumber} created</span>
          </div>
          <span className="agent-pill forge">WARP•FORGE</span>
        </div>
        <div className="px-4 py-3 flex flex-col gap-2">
          <div className="text-[13px] text-white/90 leading-snug">
            {state.title}
          </div>
          <div className="text-[11px] font-mono text-warp-blue break-all">
            {stripUrlScheme(state.issueUrl)}
          </div>
          <div className="pt-1">
            <a
              href={state.issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/85 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span>Open in GitHub</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ─── DRAFT / EDITING / CREATING / ERROR — share the same shell ──
  const isEditing = state.kind === "editing";
  const isCreating = state.kind === "creating";
  const errorMessage = state.kind === "error" ? state.message : null;

  const handleCreate = async () => {
    setState({ kind: "creating" });
    try {
      const res = await issuesFetch("/api/issues/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          title: draft.title,
          body: draft.body,
          branchSlug: draft.branchSlug,
          validationTier: draft.validationTier,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        issueNumber?: number;
        issueUrl?: string;
        title?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.issueNumber || !json?.issueUrl) {
        setState({
          kind: "error",
          message: json?.error ?? `Create failed (HTTP ${res.status})`,
        });
        return;
      }
      setState({
        kind: "created",
        issueNumber: json.issueNumber,
        issueUrl: json.issueUrl,
        title: json.title ?? draft.title,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "network error",
      });
    }
  };

  return (
    <div
      className="my-3 rounded-md overflow-hidden"
      style={{
        background: "var(--bg-elev-1)",
        border: "1px solid var(--border-soft)",
        borderLeft: "2px solid var(--warp-teal)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-hair">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/65">
          <span aria-hidden="true">🔖</span>
          <span>{isEditing ? "Editing draft" : "New issue draft"}</span>
        </div>
        <span className="agent-pill forge">WARP•FORGE</span>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2.5">
        {/* Title */}
        <FieldRow label="Title">
          {isEditing ? (
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full bg-transparent border border-hair rounded px-2 py-1 text-[13px] text-white/90 focus:outline-none focus:border-warp-teal/50"
              maxLength={256}
            />
          ) : (
            <span className="text-[13px] text-white/90 leading-snug">
              {draft.title}
            </span>
          )}
        </FieldRow>

        {/* Branch */}
        <FieldRow label="Branch">
          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-mono text-white/40">WARP/</span>
              <input
                type="text"
                value={draft.branchSlug}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    branchSlug: kebab(e.target.value),
                  })
                }
                className="flex-1 bg-transparent border border-hair rounded px-2 py-1 text-[12px] font-mono text-warp-blue focus:outline-none focus:border-warp-teal/50"
                maxLength={40}
              />
            </div>
          ) : (
            <span className="text-[12px] font-mono text-warp-blue">
              WARP/{draft.branchSlug}
            </span>
          )}
        </FieldRow>

        {/* Tier */}
        <FieldRow label="Tier">
          {isEditing ? (
            <div className="flex gap-1">
              {TIERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDraft({ ...draft, validationTier: t })}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] rounded border transition-colors ${
                    draft.validationTier === t
                      ? "border-warp-teal/60 text-warp-teal bg-warp-teal-bg"
                      : "border-hair text-white/55 hover:text-white/85"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[12px] uppercase tracking-[0.14em] text-white/75">
              {draft.validationTier}
            </span>
          )}
        </FieldRow>

        {/* Objective preview (always visible, non-editable in this card —
            the underlying body is sent verbatim to GitHub) */}
        {draft.objective && (
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 mb-1">
              Objective
            </div>
            <div className="text-[12px] text-white/75 leading-relaxed line-clamp-3">
              {draft.objective}
            </div>
          </div>
        )}

        {/* Error banner */}
        {errorMessage && (
          <div className="mt-1 px-3 py-2 rounded border border-warp-amber/40 bg-warp-amber/10 text-[11px] text-warp-amber/90 leading-relaxed break-words">
            {errorMessage}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setState({ kind: "draft" })}
                disabled={isCreating}
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setState({ kind: "editing" })}
                disabled={isCreating}
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setDiscarded(true)}
                disabled={isCreating}
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-hair text-white/55 hover:text-warp-amber hover:border-warp-amber/40 transition-colors disabled:opacity-40"
              >
                Discard
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || draft.title.trim().length === 0}
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] rounded-md border border-warp-teal/50 bg-warp-teal-bg text-warp-teal hover:bg-warp-teal/15 transition-colors disabled:opacity-40"
              >
                {isCreating ? "Creating…" : "Create issue ▶"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/45 w-14 shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
