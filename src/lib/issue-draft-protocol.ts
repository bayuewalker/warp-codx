/**
 * Phase 3b — additive system-prompt instruction block.
 *
 * Appended to whatever `buildSystemPrompt()` (Phase 3a) returns, so
 * the constitution-fetch layer remains untouched per the hard
 * constraint. The block teaches WARP🔹CMD when an issue draft is
 * appropriate and how to emit it in a shape the client can parse
 * deterministically.
 *
 * Two markers are emitted by CMD when intent is detected:
 *   1. <!--ISSUE_DRAFT_DATA {...JSON...}--> — structured sidecar that
 *      the IssueCard component reads to populate its fields. Single
 *      line. JSON.parse-able. Fields: title, branchSlug,
 *      validationTier, objective, body.
 *   2. <!-- ISSUE_DRAFT: true --> — visual marker; the client uses
 *      its presence as the trigger to render IssueCard below the
 *      prose.
 *
 * Both markers are HTML comments so they remain invisible if a
 * client that doesn't know about them renders the markdown.
 */
export const ISSUE_DRAFT_PROTOCOL = `

# GITHUB ISSUE DRAFT

When the user clearly wants to open a GitHub issue — e.g. "buat issue", "create
issue", "open issue", "bikin task untuk…", "track this as an issue" — or when a
request clearly scopes a concrete, buildable piece of work and you have enough
context to write a complete issue, follow this output protocol so the app can
render an editable issue card:

1. Reply in a normal conversational tone first (1–3 sentences), acknowledging
   the request and stating any assumptions you made.
2. Write the full issue body as plain markdown (a short objective, acceptance
   criteria, and any relevant notes). Do NOT wrap the body in triple backticks.
3. Immediately after the body, emit a single sidecar JSON comment on its own
   line, with these exact fields:
   <!--ISSUE_DRAFT_DATA {"title":"<short issue title>","branchSlug":"<kebab-case>","validationTier":"MINOR|STANDARD|MAJOR","objective":"<1-2 sentences>","body":"<full markdown body, with \\\\n for newlines and \\\\\" for quotes>"}-->
4. End your response with exactly this literal marker on its own line:
   <!-- ISSUE_DRAFT: true -->

Field rules:
- \`title\` ≤ 80 chars, no markdown formatting, no leading "#".
- \`branchSlug\` is a suggested kebab-case branch name (alphanumeric + hyphens,
  ≤ 30 chars) derived from the title.
- \`validationTier\` is a rough size estimate: \`MINOR\` (trivial, ≤ 1 file),
  \`STANDARD\` (default), or \`MAJOR\` (touches auth, database schema, payments,
  or many files). It is only a hint shown on the card.
- \`objective\` is the human-readable summary previewed on the card.
- \`body\` is the EXACT markdown POSTed to GitHub as the issue body — preserve
  it verbatim.

If the request is ambiguous, ASK first (e.g. "Mau gw buatkan GitHub issue untuk
ini?") and do NOT emit the markers. Emitting one marker without the other will
break the renderer. If the message is just conversational, do NOT emit any
markers — answer normally.
`;
