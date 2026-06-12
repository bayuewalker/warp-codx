/**
 * `/test` (alias `/showcase`, `/demo`) quick-command content.
 *
 * A single synthetic assistant turn that exercises every renderer the chat
 * surface supports — prose, key/value cards, status badges, task lists, a
 * syntax-highlighted code block, a terminal block, and the four `warp-*`
 * rich blocks (todos, action, diff, status). Injected locally (never sent to
 * the model) so an operator can eyeball the full UI/UX in one shot.
 */
export const SHOWCASE_CONTENT = `Here's a live tour of every response style WARP CodX can render. 👇

## Key / value card

A 2-column table renders as a tidy card (never a wide scrolling table):

| Field | Value |
| --- | --- |
| Runtime | Next.js 14 (App Router) |
| Deploy | fly.io · 1 machine |
| Database | Supabase (Postgres 17) |
| Model | auto-routed (Claude / GPT) |

## Status badges

A \`| Component | Status |\` table renders short states as colored badges:

| Component | Status |
| --- | --- |
| Build pipeline | COMPLETE |
| Realtime channel | COMPLETE |
| Test suite | PENDING |
| Legacy migration | ERROR |

## Task checklist

Steps and plans render as an interactive checklist:

- [x] Clone repo into sandbox
- [x] Install dependencies
- [ ] Run test suite
- [ ] Open pull request

## Code block

Fenced code gets a language chip, copy + download buttons, and collapses when long:

\`\`\`ts
// greet.ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("WARP"));
\`\`\`

## Terminal output

\`\`\`bash
$ npm run build
> next build

✓ Compiled successfully
✓ 467 tests passed
Route (app)                     Size     First Load JS
┌ ○ /                           12 kB    197 kB
└ ƒ /api/agent/runs             0 B      0 B
\`\`\`

## Rich blocks

These four are emitted as \`warp-*\` fences and render as interactive cards.

\`\`\`warp-todos
{
  "items": [
    { "text": "Validate branch slug", "subtext": "passed: WARP/dashboard-ui", "state": "done" },
    { "text": "Check open PRs", "subtext": "0 conflicts", "state": "done" },
    { "text": "Awaiting dispatch", "subtext": "tap DISPATCH to proceed", "state": "active" }
  ]
}
\`\`\`

\`\`\`warp-action
{
  "summary": "Will create {path}",
  "path": "src/components/pr/PRPanel.tsx",
  "detail": "New file at {path}",
  "output": { "action": "create", "scope": "new file", "est_lines": 120 }
}
\`\`\`

\`\`\`warp-diff
{
  "path": "src/app/api/github/route.ts",
  "added": 3,
  "removed": 1,
  "lines": [
    { "type": "ctx", "num": 12, "text": "  const octokit = new Octokit({ auth: token })" },
    { "type": "rem", "num": "-", "text": "  const { data } = await octokit.pulls.list({ owner, repo })" },
    { "type": "add", "num": "+", "text": "  const { data } = await octokit.pulls.list({" },
    { "type": "add", "num": "+", "text": "    owner, repo, state: 'open', sort: 'updated'" },
    { "type": "add", "num": "+", "text": "  })" },
    { "type": "ctx", "num": 14, "text": "  return Response.json(data)" }
  ]
}
\`\`\`

\`\`\`warp-status
{
  "rows": [
    { "name": "Branch", "note": "WARP/dashboard-ui", "state": "ok" },
    { "name": "FORGE agent", "state": "ok" },
    { "name": "Test suite", "state": "warn" }
  ]
}
\`\`\`

That's the full set — prose, cards, badges, checklist, code, terminal, and rich blocks. 🎉`;
