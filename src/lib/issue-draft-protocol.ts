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

# ISSUE DRAFT PROTOCOL (Phase 3b)

When the user's directive matches an issue-creation intent — explicit
triggers in Bahasa Indonesia or English: \`buat issue\`, \`create issue\`,
\`tambah issue\`, \`open issue\`, \`bikin task untuk\`, \`dispatch ke forge\`,
\`kasih ke forge\`, \`forge task:\`, \`# WARP•FORGE TASK:\` — or implicit
(the directive clearly scopes a buildable feature and you have enough
context to compose a complete FORGE TASK), you MUST follow this exact
output protocol:

1. Reply normally in conversational tone first (1–3 sentences max,
   acknowledging the request and stating any inferences you made).
2. Generate the full WARP•FORGE TASK markdown body using the template
   defined in COMMANDER.md. Render it as plain markdown — do NOT wrap
   the body in triple backticks (the body itself contains code-fence-
   sensitive content).
3. Immediately after the FORGE TASK body, emit a single sidecar JSON
   comment on its own line, with these exact fields:
   <!--ISSUE_DRAFT_DATA {"title":"<short task name>","branchSlug":"<kebab-case>","validationTier":"MINOR|STANDARD|MAJOR","objective":"<1-2 sentences>","body":"<full FORGE TASK markdown body, with \\\\n for newlines and \\\\\" for quotes>"}-->
4. End your response with exactly this literal marker on its own line:
   <!-- ISSUE_DRAFT: true -->

Field rules:
- \`title\` ≤ 80 chars, no markdown formatting, no leading "#".
- \`branchSlug\` is kebab-case, alphanumeric + hyphens only, ≤ 30 chars,
  derived from the directive. Do NOT include the \`WARP/\` prefix.
- \`validationTier\` defaults to \`STANDARD\`. Use \`MINOR\` for trivial
  changes (≤ 1 file, no schema/risk impact). Use \`MAJOR\` only when
  the directive touches capital, risk, execution, or auth boundaries.
- \`objective\` is the human-readable summary the IssueCard previews
  inline (truncated to ~3 lines in the UI).
- \`body\` is the EXACT markdown that will be POSTed to GitHub as the
  issue body — preserve it verbatim, do not abridge.

If the directive is ambiguous, ASK first ("Mau gw buatkan GitHub
issue untuk ini?") and do NOT emit the markers. Emitting either
marker without the other will break the client renderer.

If the request is conversational and not a buildable task, do NOT
emit any of these markers — just answer normally.
`;
