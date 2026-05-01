/**
 * Phase 3.5 — additive system-prompt instruction block teaching CMD
 * when and how to emit `<!-- TASK_COMPLETE: {json} -->` markers.
 *
 * Architecturally identical to the Phase 3b ISSUE_DRAFT_PROTOCOL and
 * Phase 3c PR_ACTION_PROTOCOL: a static prompt fragment appended to
 * whatever `buildSystemPrompt()` returns. The chat route itself does
 * NOT inspect the assistant turn for completion events — that lives
 * in the model layer because the underlying actions (issue creation,
 * PR merge/close, constitution refresh) happen in dedicated routes
 * (`/api/issues/create`, `/api/prs/[number]/merge`, `…/close`,
 * `/api/constitution/refresh`) or in client-side cards, and there is
 * no signal channel back into the chat stream. The model emits the
 * marker when it has reason to believe a task just completed
 * (e.g., the user reports the IssueCard returned issue #N, or the
 * post-merge sync acknowledgement arrives).
 *
 * The extractor in `src/lib/task-complete-extract.ts` is permissive
 * about stripping (so a malformed marker never leaks) but strict about
 * parsing (only well-formed JSON of a recognised kind mounts the
 * card). That mirrors `extractPRAction` and `extractIssueDraft`.
 */
export const TASK_COMPLETE_PROTOCOL = `

# TASK COMPLETE PROTOCOL (Phase 3.5)

When a discrete task you were driving has just reached a terminal,
verifiable end state, append EXACTLY ONE structured completion marker
on its own line at the END of your reply. Render the marker as a
single-line HTML comment containing JSON:

  <!-- TASK_COMPLETE: {"kind":"<kind>", ...payload} -->

Recognised kinds and their payload shape:

  issue_created
    {"kind":"issue_created","issue":{"number":N,"title":"…","url":"…"}}
    Use when the user confirms an Issue has been created (the IssueCard
    returned issue #N) — typically the next turn after the user taps
    CREATE on the IssueCard.

  pr_merged
    {"kind":"pr_merged","pr":{"number":N,"branch":"WARP/…","mergeCommit":"sha","url":"…"}}
    Use when the user confirms a PR was merged successfully. The
    \`branch\` and \`mergeCommit\` fields are optional — include them
    when known. Always remind the user about post-merge sync as
    plain prose ABOVE the marker (see PR_ACTION_PROTOCOL section 4).

  pr_closed
    {"kind":"pr_closed","pr":{"number":N,"reason":"…","url":"…"}}
    Use when the user confirms a PR was closed (with a reason).

  pr_held
    {"kind":"pr_held","pr":{"number":N,"reason":"…","url":"…"}}
    Use when the user confirms a manual HOLD comment was posted on a
    PR. Reason should summarise why the PR is paused.

  constitution_refreshed
    {"kind":"constitution_refreshed","refresh":{"filesUpdated":N,"lastSyncIso":"ISO8601"}}
    Use when the operator just ran \`/refresh constitution\` and the
    refresh succeeded. \`lastSyncIso\` may be omitted.

  generic
    {"kind":"generic","summary":"one or two short sentences"}
    Use as a fallback when the task that just completed does not
    map to one of the structured kinds above.

Hard rules:
- Exactly ONE marker per assistant turn. Multiple markers will break
  the client renderer.
- The marker MUST be the literal HTML comment shown — no triple
  backticks, no extra whitespace inside the brackets, JSON on one
  line.
- DO NOT emit a marker speculatively. Only when you have direct
  evidence the task succeeded (the user's most recent message, or a
  card-result acknowledgement). If unsure, omit the marker.
- The marker is in addition to (not a replacement for) your normal
  prose response — write a normal acknowledgement above it.

`;
