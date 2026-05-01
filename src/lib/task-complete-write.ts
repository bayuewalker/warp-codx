/**
 * Phase 3.5 (option a) — server-side helper that injects a
 * `<!-- TASK_COMPLETE: {json} -->` marker into a chat session as a
 * synthetic assistant message, so the operator sees the
 * `TaskCompleteCard` immediately after a card-triggered action
 * (issue create, PR merge / close / hold, constitution refresh)
 * without having to wait for the next LLM turn.
 *
 * Two emission paths feed the same client extractor:
 *
 *   1. ROUTE-SIDE  (this file)   — authoritative for the five action
 *      kinds whose success is observed server-side. Fires from each
 *      action route after the GitHub call returns OK.
 *
 *   2. LLM-SIDE    (`TASK_COMPLETE_PROTOCOL`) — fallback. Used for
 *      `generic` and for cases where the success was reported via
 *      means other than the cards (e.g. "I merged that on GitHub
 *      directly"). The protocol explicitly tells CMD NOT to
 *      duplicate the five route-emitted kinds.
 *
 * Both paths INSERT a `role='assistant'` row into `public.messages`
 * with the marker appended; `MessageContent.tsx` runs
 * `extractTaskComplete` on every assistant message and renders the
 * card. Realtime publication is enabled on `public.messages`, so
 * the row surfaces in `ChatArea` the instant it lands — no client
 * refresh required.
 *
 * Contract:
 *   - Silent no-op when `sessionId` is null/undefined/"" — the four
 *     PR + issue routes accept anonymous calls and the no-session
 *     case must not write rows attributed to a non-existent FK.
 *   - Best-effort: every error is caught and logged. The route
 *     response NEVER depends on this succeeding. Mirrors the
 *     `sendPushToAll` contract.
 *   - The marker JSON is escape-hardened: any literal `-->` inside
 *     a string value is rewritten to `--\u003e` so the
 *     `extractTaskComplete` regex (non-greedy `[\s\S]*?-->`) cannot
 *     terminate early on user-supplied content. `JSON.parse` in the
 *     extractor rehydrates the original character.
 */
import { getServerSupabase } from "@/lib/supabase";
import type { TaskCompletePayload } from "@/lib/task-complete-extract";

export async function writeTaskCompleteMessage(
  sessionId: string | null | undefined,
  payload: TaskCompletePayload,
): Promise<void> {
  if (!sessionId) return;

  try {
    const prose = renderProse(payload);
    const json = JSON.stringify(payload).replace(/-->/g, "--\\u003e");
    const marker = `<!-- TASK_COMPLETE: ${json} -->`;
    const content = `${prose}\n\n${marker}`;

    const supabase = getServerSupabase();
    const { error } = await supabase.from("messages").insert({
      session_id: sessionId,
      role: "assistant",
      content,
    });
    if (error) {
      console.error(
        `[task-complete-write] insert failed (session=${sessionId}, kind=${payload.kind}): ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[task-complete-write] threw (session=${sessionId}, kind=${payload.kind}): ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}

/**
 * Short prose accompaniment so the chat row reads naturally even if
 * the card fails to render (e.g. extractor rejects malformed JSON).
 * Kept to ONE sentence — `TaskCompleteCard` is the rich surface.
 */
function renderProse(p: TaskCompletePayload): string {
  switch (p.kind) {
    case "issue_created":
      return `Issue #${p.issue.number} created — **${p.issue.title}**.`;
    case "pr_merged": {
      const parts = [`PR #${p.pr.number} merged`];
      if (p.pr.branch) parts.push(`(${p.pr.branch})`);
      return `${parts.join(" ")}. Post-merge sync required.`;
    }
    case "pr_closed":
      return p.pr.reason
        ? `PR #${p.pr.number} closed — ${p.pr.reason}.`
        : `PR #${p.pr.number} closed.`;
    case "pr_held":
      return p.pr.reason
        ? `PR #${p.pr.number} held — ${p.pr.reason}.`
        : `PR #${p.pr.number} held.`;
    case "constitution_refreshed":
      return `Constitution refreshed — ${p.refresh.filesUpdated} file${
        p.refresh.filesUpdated === 1 ? "" : "s"
      } updated.`;
    case "generic":
      return p.summary;
  }
}
