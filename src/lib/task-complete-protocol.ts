/**
 * Phase 3.5 — additive system-prompt instruction block teaching CMD
 * when and how to emit `<!-- TASK_COMPLETE: {json} -->` markers.
 *
 * Architecturally identical to the Phase 3b ISSUE_DRAFT_PROTOCOL and
 * Phase 3c PR_ACTION_PROTOCOL: a static prompt fragment appended to
 * whatever `buildSystemPrompt()` returns.
 *
 * Two emission paths now exist (Phase 3.5 option a):
 *
 *   1. ROUTE-SIDE — `src/lib/task-complete-write.ts`. The action
 *      routes (`/api/issues/create`, `/api/prs/[number]/{merge,
 *      close,hold}`, `/api/constitution/refresh` when called with
 *      `sessionId`) now fire-and-forget a synthetic assistant
 *      message containing the marker after their GitHub call
 *      succeeds. This is the AUTHORITATIVE path for those five
 *      kinds — the operator sees the card the moment the row lands
 *      via Realtime, no LLM round-trip required.
 *
 *   2. LLM-SIDE — this protocol. Used as the FALLBACK for `generic`
 *      (the route never auto-emits generic markers because there is
 *      no server-side signal for "the operator finished an ad-hoc
 *      thing") and for any of the five structured kinds when the
 *      success was reported via means other than the cards (e.g.
 *      "I just merged that on GitHub directly").
 *
 * The protocol body (the `DUPLICATE-CARD AVOIDANCE` block below)
 * tells CMD when to stay silent so the operator never sees two cards
 * for the same event.
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

DUPLICATE-CARD AVOIDANCE (Phase 3.5 option a)
The chat infrastructure now emits these markers SERVER-SIDE for the
following kinds when the operator triggers them via the IssueCard /
PRCard / Settings cards:
  - issue_created            (POST /api/issues/create)
  - pr_merged                (POST /api/prs/[number]/merge)
  - pr_closed                (POST /api/prs/[number]/close)
  - pr_held                  (POST /api/prs/[number]/hold)
  - constitution_refreshed   (POST /api/constitution/refresh, when
                              the request body includes a sessionId)
You will see the resulting "task complete" assistant turn already
in the conversation history. DO NOT emit a duplicate marker for the
same event — the operator already has the card.

You may still emit one of the five kinds yourself when:
  (a) The success was reported via means OTHER than the cards
      (e.g. "I just merged that on GitHub directly", or a refresh
      ran from a different tab and the card never fired).
  (b) The kind is \`generic\` — that one is never auto-emitted
      server-side because there is no signal channel for ad-hoc
      tasks.

If unsure whether the route already emitted the card, prefer to
stay silent. A missing card is recoverable (the operator can ask);
duplicate cards are visual noise.

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
