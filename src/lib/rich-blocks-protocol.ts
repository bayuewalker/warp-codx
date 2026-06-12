/**
 * Rich-blocks protocol — additive system-prompt instruction block
 * teaching CMD to emit the four `warp-*` fenced JSON blocks that the
 * client renders as interactive cards (Ona/Open-Code-style action
 * rows, diff viewers, live todo trackers, status tables).
 *
 * Architecturally identical to ISSUE_DRAFT_PROTOCOL /
 * PR_ACTION_PROTOCOL / TASK_COMPLETE_PROTOCOL: a static prompt
 * fragment appended to whatever `buildChatSystemPrompt()` returns.
 *
 * The render pipeline already exists end-to-end:
 *   - `src/lib/rich-blocks-extract.ts` pulls well-formed fences out of
 *     the markdown (malformed JSON is stripped, never leaked).
 *   - `src/components/blocks/{ActionCard,DiffBlock,TodoBlock,
 *     StatusTable}.tsx` render them.
 *   - 2+ blocks in one turn collapse into a "Working — N actions"
 *     section (`CollapsibleSection`), matching design-ref Pattern D.
 *
 * Until this protocol existed the model had no way to know about the
 * fence contract, so replies rendered as plain markdown and the cards
 * never mounted. The payload shapes below MUST stay in sync with
 * `src/lib/types.ts` (ActionPayload / DiffPayload / TodosPayload /
 * StatusPayload).
 */
export const RICH_BLOCKS_PROTOCOL = `

# RICH BLOCKS PROTOCOL

The app renders four special fenced blocks as interactive cards.
Each block is a fenced code block whose language tag is one of
\`warp-action\`, \`warp-diff\`, \`warp-todos\`, \`warp-status\` and whose
body is EXACTLY ONE valid JSON object (double-quoted keys/strings, no
comments, no trailing commas). The opening fence must start at column
0 (never indented, never nested inside a list item or quote).

WHEN TO USE WHICH

## warp-action
One discrete operational step you performed or are about to perform:
ran a command, read/created/replaced a file, called an API. Emit one
block per step, in execution order. Renders as a collapsible
"› Replaced text in <path>" row. Example (fence at column 0):

\`\`\`warp-action
{"summary":"Replaced text in {path}","path":"src/lib/auth.ts","detail":"Swapped the session check in {path} for the shared helper","output":{"message":"String replacement completed","edits":1}}
\`\`\`

Fields: summary (required; "{path}" token renders as mono), path,
detail, output (object or string), defaultOpen (boolean).

## warp-diff
An exact code change to one file. ALWAYS prefer this over a plain
\`\`\`diff fence or before/after code blocks. Renders with red/green
lines, line numbers and a +N −N counter. Example:

\`\`\`warp-diff
{"path":"src/app/api/github/route.ts","lines":[{"type":"ctx","num":12,"text":"  const octokit = new Octokit({ auth: token })"},{"type":"rem","num":"-","text":"  const { data } = await octokit.pulls.list({ owner, repo })"},{"type":"add","num":14,"text":"  const { data } = await octokit.pulls.list({ owner, repo, state: 'open' })"}]}
\`\`\`

Line types: "add" / "rem" / "ctx". \`num\` is the gutter label
(number, or "-" for removed lines). Include 1-3 ctx lines around
each change. Optional: added, removed (counters), language.

## warp-todos
Live progress tracker for a multi-step task YOU are driving across
the conversation. States: "done" (green check), "active" (spinner —
at most ONE), "idle" (empty circle). Re-emit the full updated list
each turn the state changes. Example:

\`\`\`warp-todos
{"items":[{"text":"Validate branch slug","subtext":"passed: WARP/dashboard-ui","state":"done"},{"text":"Check conflicting open PRs","state":"active"},{"text":"Dispatch FORGE","state":"idle"}]}
\`\`\`

Use a plain markdown task list (\`- [ ]\`) ONLY for static checklist
CONTENT (e.g. example checklists the user asked to see); use
warp-todos whenever you are tracking your own work.

## warp-status
Environment / component check rundown with pass-fail chips. States:
"ok" / "pending" / "fail". Example:

\`\`\`warp-status
{"rows":[{"name":"Branch","note":"WARP/dashboard-ui","state":"ok"},{"name":"FORGE agent","state":"ok"},{"name":"Test suite","state":"pending"}]}
\`\`\`

Use this for live system/check state. Keep using a 2-column markdown
table (| Field | Value |) for plain key/value DATA.

HARD RULES
- Body must parse as JSON — a malformed block is silently dropped and
  the user sees nothing. When in doubt, keep payloads small.
- Prose stays OUTSIDE the fences. Never put explanations inside the
  JSON; never wrap these fences inside another code fence.
- Each block renders as a card exactly where you place it — put the
  fence right after the sentence that narrates it. A consecutive run
  of 2+ blocks (nothing but blank lines between them) collapses
  behind one "Working — N actions" header, so group related steps.
- When the user asks to SEE your response formats, demonstrating
  these blocks with sample payloads is correct and encouraged. But
  never fabricate action/diff rows implying real work happened when
  it did not.

`;
