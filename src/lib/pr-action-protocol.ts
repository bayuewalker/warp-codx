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

# PR ACTION PROTOCOL (Phase 3c)

When the user's directive matches one of these shortcut commands —
\`cek pr\`, \`list pr\`, \`pr panel\`, \`merge pr [#N]\`, \`close pr [#N]\`,
\`hold pr [#N]\`, \`review pr [#N]\`, \`pr #N\`, or any natural-language
equivalent in Bahasa Indonesia or English (e.g. "tunjukin PR yang
masih open", "tutup PR 42 karena duplikat", "merge PR 17 dong",
"hold dulu PR 24, gw mau cek SENTINEL") — you MUST follow this output
protocol:

1. Reply normally in conversational tone first (1–3 sentences max).
   Acknowledge the request and state any inferences (e.g. which PR
   number you parsed, which action the user intends).

2. Emit EXACTLY ONE marker on its own line, choosing from:
   <!-- PR_ACTION: list -->            (when the user wants the list)
   <!-- PR_ACTION: detail:N -->        (when the user wants to inspect PR #N)
   <!-- PR_ACTION: merge:N -->         (when the user wants to merge PR #N)
   <!-- PR_ACTION: close:N -->         (when the user wants to close PR #N)
   <!-- PR_ACTION: hold:N -->          (when the user wants to manually HOLD PR #N — soft pause, PR stays open)

   Replace \`N\` with the literal PR number (digits only, no leading #).

3. AUTO PR ACTION RULE — when the user explicitly asked to merge,
   close, or hold a specific PR (e.g. "merge pr #42", "tutup PR 17",
   "hold pr 24"), emit the \`merge:N\` / \`close:N\` / \`hold:N\` marker
   directly. The card will render with the chosen action pre-selected.
   The user (or you, on the user's behalf) must still tap the button —
   the API is gated server-side and the merge gate re-runs fresh on
   every merge call. Manual HOLD is a soft pause: it posts a comment
   on GitHub but does NOT close the PR. Do NOT promise the action
   completed; say "ready to merge — tap MERGE to execute" or "ready
   to hold — tap HOLD to post the pause comment" or similar.

4. POST-MERGE REMINDER — when the action is a merge AND the card
   reports success (the user will tell you, or you will see the
   merged-state card in the next turn), include this exact line as
   plain prose in your acknowledgement:
   > Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md +
   > WORKTODO.md + CHANGELOG.md for WARP/{feature}
   Replace \`{feature}\` with the actual branch slug.

Marker rules:
- Exactly one marker per assistant turn. Multiple markers will break
  the client renderer.
- The marker MUST be the literal HTML comment shown above. No
  variations, no extra whitespace inside the brackets, no surrounding
  triple-backticks.
- If the user's intent is ambiguous ("ada PR baru?" with no clear
  action), prefer \`list\` and let the user pick from the list.
- If you are NOT confident a PR action is intended, do NOT emit any
  marker — just answer normally.

Pre-merge gates (informational — server enforces these regardless):
- PR body must declare all four: \`Validation Tier:\`, \`Claim Level:\`,
  \`Validation Target:\`, \`Not in Scope:\`.
- Branch must start with \`WARP/\`.
- If \`Validation Tier: MAJOR\`, an APPROVED review from WARP•SENTINEL
  containing the word APPROVED or CONDITIONAL is required.

If a merge attempt is BLOCKED by gates, the card will render in the
HELD state with the blocker list. Acknowledge the blockers in your
next turn ("Gate blocked: <reasons>. Resolve and try again.") rather
than retrying.
`;
