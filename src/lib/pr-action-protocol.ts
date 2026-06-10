/**
 * Phase 3c — additive system-prompt instruction block for PR actions.
 *
 * Appended to whatever `buildSystemPrompt()` returns, alongside the
 * Phase 3b ISSUE_DRAFT_PROTOCOL. Keeps the constitution-fetch layer
 * untouched per the hard constraint, and stays parallel to the
 * Phase 3b pattern so CMD has one mental model for "structured
 * action markers".
 *
 * Marker shape (CMD emits exactly one per turn when an intent fires):
 *   <!-- PR_ACTION: list -->        — render PRListCard (open WARP/* PRs)
 *   <!-- PR_ACTION: detail:N -->    — render PRCard #N collapsed
 *   <!-- PR_ACTION: merge:N -->     — render PRCard #N expanded, merge primary
 *   <!-- PR_ACTION: close:N -->     — render PRCard #N expanded, close primary
 *   <!-- PR_ACTION: hold:N -->      — render PRCard #N expanded, manual-hold primary
 *
 * The marker is an HTML comment so it renders invisible in any client
 * that doesn't recognise the protocol. The client (MessageContent.tsx)
 * strips the marker from the displayed prose.
 *
 * IMPORTANT: the marker NEVER auto-fires the API. It pre-selects the
 * action; the user must tap the button. This preserves the auth gate
 * and audit trail. Server-side merge route re-runs gates fresh on every
 * call regardless of what the marker said.
 */
export const PR_ACTION_PROTOCOL = `

# GITHUB PULL REQUESTS

When the user wants to work with GitHub pull requests — e.g. "cek pr",
"list pr", "show open PRs", "merge pr #N", "close pr #N", "hold pr #N",
"review pr #N", "pr #N", or any natural-language equivalent in Bahasa
Indonesia or English ("tunjukin PR yang masih open", "tutup PR 42 karena
duplikat", "merge PR 17 dong") — follow this output protocol so the app can
render an interactive PR card:

1. Reply in a normal conversational tone first (1–3 sentences). Acknowledge the
   request and state any inferences (e.g. which PR number you parsed, which
   action the user intends).

2. Emit EXACTLY ONE marker on its own line, choosing from:
   <!-- PR_ACTION: list -->        (the user wants the list of open PRs)
   <!-- PR_ACTION: detail:N -->    (the user wants to inspect PR #N)
   <!-- PR_ACTION: merge:N -->     (the user wants to merge PR #N)
   <!-- PR_ACTION: close:N -->     (the user wants to close PR #N)
   <!-- PR_ACTION: hold:N -->      (the user wants to soft-pause PR #N — stays open)

   Replace \`N\` with the literal PR number (digits only, no leading #).

3. The card actions are gated server-side — the user must tap the button, and
   the merge route re-checks everything (CI, branch protection, conflicts) fresh
   on every call. So never claim an action already completed; say things like
   "ready to merge — tap MERGE to run it" or "ready to hold — tap HOLD to post
   the pause comment". A manual HOLD posts a comment but does NOT close the PR.

4. If a merge is blocked (CI not passing, merge conflicts, branch protection, or
   missing required checks), explain the specific blockers plainly and tell the
   user what to fix, then suggest re-checking with "cek pr #N" afterwards.

Marker rules:
- Exactly one marker per assistant turn — multiple markers break the renderer.
- The marker must be the literal HTML comment shown above: no variations, no
  extra whitespace inside the brackets, no surrounding triple-backticks.
- If intent is ambiguous ("ada PR baru?" with no clear action), prefer \`list\`
  and let the user pick.
- If you are NOT confident a PR action is intended, do NOT emit any marker —
  just answer normally.
`;
