import MessageContent from "@/components/MessageContent";

const FIXTURE = `Routing ke WARP•FORGE di WARP/dashboard-ui. Pre-flight checks dulu sebelum dispatch.

\`\`\`warp-todos
{
  "items": [
    { "text": "Validate branch slug format", "subtext": "passed: WARP/dashboard-ui", "state": "done" },
    { "text": "Check no conflicting open PRs", "subtext": "0 conflicts found", "state": "done" },
    { "text": "Verify FORGE agent operational", "subtext": "last heartbeat: 3s ago", "state": "done" },
    { "text": "Awaiting dispatch confirmation", "subtext": "tap DISPATCH below to proceed", "state": "active" }
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
  "added": 4,
  "removed": 1,
  "lines": [
    { "type": "ctx", "num": 12, "text": "  const octokit = new Octokit({ auth: token })" },
    { "type": "ctx", "num": 13, "text": "" },
    { "type": "rem", "num": "-",  "text": "  const { data } = await octokit.pulls.list({ owner, repo })" },
    { "type": "add", "num": "+",  "text": "  const { data } = await octokit.pulls.list({" },
    { "type": "add", "num": "+",  "text": "    owner, repo, state: 'open'," },
    { "type": "add", "num": "+",  "text": "    sort: 'updated', per_page: 30" },
    { "type": "add", "num": "+",  "text": "  })" },
    { "type": "ctx", "num": 15, "text": "" },
    { "type": "ctx", "num": 16, "text": "  return Response.json(data)" }
  ]
}
\`\`\`

Environment ready for dispatch:

\`\`\`warp-status
{
  "rows": [
    { "name": "Branch", "note": "WARP/dashboard-ui", "state": "ok" },
    { "name": "FORGE agent", "state": "ok" },
    { "name": "GitHub API connection", "state": "ok" },
    { "name": "Test suite passing", "state": "ok" }
  ]
}
\`\`\`

All checks passed. Ready when you are — tap **Dispatch** to launch WARP•FORGE.

For comparison, here's a WARP•SENTINEL alert and a WARP•ECHO note alongside the active branch WARP/feature-x.`;

const USER_FIXTURE =
  "Build dashboard dengan real-time PR panel dan metrics. Branch slug: dashboard-ui.";

export default function DevBlocksPage() {
  return (
    <div className="min-h-screen bg-warp-bg text-white p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-8">
        <header className="space-y-1">
          <div className="text-warp-blue text-xs tracking-[0.18em] uppercase">
            Dev fixture
          </div>
          <h1 className="text-2xl font-semibold">
            <span className="text-warp-blue">WARP</span> CodX rich blocks
          </h1>
          <p className="text-sm text-white/55 leading-relaxed">
            One of each renderer with hand-written sample data. The chat
            stream pipes through the same <code>MessageContent</code>{" "}
            component, so anything that looks right here will look right in
            a real session once the assistant starts emitting{" "}
            <code>warp-*</code> fences.
          </p>
        </header>

        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            User turn
          </div>
          <MessageContent content={USER_FIXTURE} role="user" />
        </section>

        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Assistant turn — prose + warp-todos + warp-action + warp-diff +
            warp-status
          </div>
          <MessageContent content={FIXTURE} role="assistant" />
        </section>
      </div>
    </div>
  );
}
