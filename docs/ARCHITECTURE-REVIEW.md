# WARP CodX — Architecture Review & Refactor Notes

*Senior-engineer onboarding review, 2026-06-11. Companion to the
"code-quality refactor" PR — documents the system as found, the problems
identified, what the PR fixes, and what it deliberately leaves for
follow-ups.*

---

## 1. System architecture (as reverse-engineered)

WARP CodX is a Next.js 14 (App Router) chat-ops console: a streaming AI
chat that can also drive GitHub workflows (issues, PR merge gates) and a
sandboxed coding agent. One Node server (fly.io / Docker), Supabase for
data + auth + realtime, OpenAI-compatible providers for inference.

### 1.1 Layers

```
┌────────────────────────── Browser (React 18) ──────────────────────────┐
│ AppShell ─ Sidebar / ChatArea / ChatInput / WorkspaceSettings           │
│ MessageContent: marker extraction → rich cards (Issue/PR/TaskComplete)  │
│ fetch wrappers: api-fetch (user JWT) · prs/issues/admin-fetch (tokens)  │
│ Supabase Realtime: messages / sessions live updates                     │
└──────────────┬──────────────────────────────────────────────┬──────────┘
               │ HTTPS + Bearer (Supabase JWT)                │ admin headers
┌──────────────▼──────────────── API routes ──────────────────▼──────────┐
│ user-gated: /api/chat /api/sessions* /api/messages /api/memory          │
│            /api/skills /api/settings /api/me /api/agent/runs*           │
│ role-gated (ADMIN_EMAILS): /api/admin/provider-keys*                    │
│ token-gated (WARP_ADMIN_TOKEN): /api/prs* /api/issues*                  │
│ secret-gated (CONSTITUTION_ADMIN_SECRET): /api/constitution*            │
└──────┬───────────────┬───────────────┬──────────────┬──────────────────┘
       │               │               │              │
┌──────▼─────┐  ┌──────▼──────┐ ┌──────▼─────┐ ┌──────▼───────────┐
│ Supabase   │  │ LLM chain   │ │ GitHub     │ │ Agent subsystem  │
│ (service   │  │ provider-   │ │ Octokit ×3 │ │ model-router →   │
│ role +     │  │ chain → llm │ │ (const./   │ │ orchestrator →   │
│ RLS anon)  │  │ failover    │ │ issues/prs)│ │ ReAct loop →     │
│            │  │             │ │            │ │ Daytona sandbox  │
└────────────┘  └─────────────┘ └────────────┘ └──────────────────┘
```

### 1.2 The chat data flow (hot path)

1. `ChatInput` → `POST /api/chat` with `{sessionId, content, model}`.
2. `requireUser()` resolves the Supabase JWT → role (+ profile upsert).
3. Session ownership check → insert user message → bump session
   `updated_at` (+ auto-label on first message).
4. **Full** message history for the session is loaded and sent to the
   model (no windowing — see §3.1).
5. `buildChatSystemPrompt()` composes: base identity + custom
   instructions + active memory + skills (advertised always, bodies
   injected on trigger match). Four protocol blocks are appended
   (issue-draft, PR-action, task-complete, neutral-identity).
6. `openChatStreamWithFailover()` walks the provider chain (DB-managed
   keys by priority, env keys as fallback); credit/quota/invalid-model
   errors fall through to the next candidate; other errors surface.
7. Deltas stream to the browser as `text/plain`; the assembled reply is
   persisted, the session is bumped again, and memory extraction runs as
   a detached best-effort task.
8. Marker comments in the reply (`ISSUE_DRAFT`, `PR_ACTION`,
   `TASK_COMPLETE`, rich blocks) are parsed client-side by
   `MessageContent` into interactive cards. Card actions call the
   admin-gated routes, which re-verify everything server-side.

The design principle worth preserving: **the server re-derives all
gate-relevant state at action time** (`evaluateGatesForPR` re-fetches the
PR, its reviews, the paired FORGE PR, and live CI status). The marker
protocol only *pre-selects* UI; it never carries authority.

### 1.3 Auth model (four parallel surfaces)

| Surface | Mechanism | Header / source | Routes |
|---|---|---|---|
| User | Supabase JWT (magic link) | `Authorization: Bearer` | chat, sessions, memory, skills, agent runs |
| Admin role | `ADMIN_EMAILS` env match | same JWT | `/api/admin/provider-keys*` |
| Ops token | `WARP_ADMIN_TOKEN` | `x-warp-admin-token` | `/api/prs*`, `/api/issues*` |
| Constitution secret | `CONSTITUTION_ADMIN_SECRET` | `x-admin-secret` | `/api/constitution*` |

Each browser-side wrapper caches its secret in `sessionStorage` and
clears it on rejection. These four are intentional (different blast
radii), but the *plumbing* was triplicated — now shared
(`src/lib/session-token-fetch.ts`), with the per-surface contracts
unchanged.

---

## 2. What this PR changed (behavior-preserving)

| Area | Before | After |
|---|---|---|
| `getServerSupabase()` (64-edge god node) | new client per call, several calls per request | memoized singleton (stateless client; browser client was already memoized) |
| PR routes (merge/close/hold/detail) | 4 copies of `audit()`, param parsing, reason validation, gate-input resolution, fire-and-forget boilerplate | `src/lib/pr-route-helpers.ts`; merge & detail now share `evaluateGatesForPR()` so the card provably renders what the server enforces |
| Gate input fetches | FORGE-pair lookup then CI status, sequential | `Promise.all` — one GitHub round-trip latency saved per gate evaluation |
| Browser token wrappers | `prs-fetch` / `issues-fetch` / `admin-fetch` ~90% identical (incl. dead `emitStatus()` copies) | `createSessionTokenClient()` factory; public APIs byte-compatible |
| Admin gate boilerplate | `gate()` ×3, `unauthorized()` ×2 redefined per route | `src/lib/route-helpers.ts` |
| Balance route | fetched **all** provider keys to find one | `getProviderKey(id)` single-row query |
| Chat route | session update duplicated in both branches; memory extraction **awaited inside the stream**, holding the response open for a second LLM round-trip | single conditional patch; extraction detached (stream closes when the reply is persisted) |
| `formatRelative` ×4, `stripUrlScheme` ×2 in components | byte-identical local copies | `src/lib/format.ts` |
| `MessageContent` | `mdComponents` (10 renderers) and `AGENT_LABELS` rebuilt **per render per streamed chunk** | hoisted to module scope (stable identity for ReactMarkdown) |
| `isCodingMessage()` | keyword regex recompiled per message | hoisted pattern |
| `isSelectableModelId()` | hand-maintained 6-way union check | derived from `SELECTABLE_MODELS` (one source of truth) |
| Memory dedup | two sequential `listMemories()` awaits | parallel |

Verification: `tsc --noEmit` clean, all 424 vitest tests pass unchanged,
production `next build` succeeds. Net **≈ −430 lines**.

---

## 3. Critical problem areas (known, deliberately NOT changed here)

These change observable behavior or DB/IO patterns and deserve their own
reviewed PRs.

### 3.1 Unbounded chat context (cost + latency time bomb)
`/api/chat` sends the **entire** session history to the model every turn
(`src/app/api/chat/route.ts`). A 200-message session pays for all 200
messages per turn and will eventually overflow the model context.
*Recommendation:* window to the last N messages within a token budget;
optionally summarize the truncated head into a synthetic system note.

### 3.2 Agent loop growth + steps churn
`src/lib/agent/loop.ts` accumulates every tool output (≤16 KB each) into
the message array with no windowing — worst case ~2 MB per LLM call at 20
steps. `run-service.ts` also rewrites the **full** `steps` JSONB array on
every step (O(n²) write volume). *Recommendation:* truncate/summarize old
tool outputs; append steps incrementally or buffer updates.

### 3.3 No timeout on detached agent runs
`executeRun()` is fire-and-forget with no deadline; a hung sandbox or LLM
call holds one of the 2 concurrency slots forever (until redeploy).
*Recommendation:* `Promise.race` with a hard wall-clock budget that
finalizes the run as `error`, plus a startup sweep for orphaned `running`
rows.

### 3.4 `ensureProfile()` upsert on every authenticated request
`requireUser()` (`src/lib/roles.ts`) writes to `profiles` on *every* API
call — the most frequent write in the system. *Recommendation:*
per-process TTL cache keyed on `(id, email, role)`.

### 3.5 Per-request `auth.getUser()` round-trip
`getRequestUser()` validates the JWT by calling Supabase Auth over HTTP
each request. *Recommendation:* verify the JWT signature locally
(`SUPABASE_JWT_SECRET`) and keep the network call as fallback.

### 3.6 Error-shape drift across the API
`"invalid_json"` vs `"Invalid JSON body"`; `{error: "forbidden"}` vs
`{error: result.error}`. Clients string-match on some of these, so this
needs a coordinated client+server change. *Recommendation:* standardize
on one envelope (`{ error: { code, message } }`) behind a versioned
rollout.

### 3.7 Octokit triplication (constitution / issues / prs)
Three `getClient()` singletons with different timeouts and PAT envs.
Phase-3a comments mark the constitution module as frozen, so it was left
alone. *Recommendation:* one factory parameterized by timeout once the
freeze lifts.

### 3.8 `model-router` heuristics
Keyword-regex difficulty classification (`refactor` → Opus even for a
trivial task). Works, but wastes credits at the margins; no feedback
loop. Cheap improvement: let the user override tier per run.

---

## 4. UI/UX notes

Done in this PR (render-path only, zero visual change):
- `MessageContent` no longer rebuilds its markdown renderer map per
  streamed chunk — less GC pressure and stable component identities
  during streaming, which is where the UI is most re-render-heavy.

Recommended (visual/structural, needs product sign-off so not done
here):
- **Component size:** `PRCard.tsx` (~1,000 lines, 9-state machine) and
  `WorkspaceSettings.tsx` (~880 lines, 5 inline tab components) should be
  split (`usePRCardState()` hook + `components/settings/*` tab files).
- **Fetch state machines:** IssuesView / PRListView / PRListCard /
  ConstitutionBadge each re-implement `loading/error/data + refresh`; a
  `useFetch()` hook would delete ~150 lines and unify error UX.
- **Clock-tick re-renders:** `SessionRow` re-renders every row on a 30 s
  interval just to refresh "5m ago" labels; one shared ticker (context)
  or `<time>` + CSS would do.
- **A11y:** icon buttons are generally labeled; modal backdrops use
  `role="dialog"` correctly. Remaining gap: a few decorative SVGs in
  `ConstitutionSettings` lack `aria-hidden`.
- **CSS:** Tailwind + two large global stylesheets
  (`message-content.css`, `blocks.css`) + one CSS module. Prefix-scoped
  classes (`msg-*`, `blk-*`) or modules would remove collision risk.

---

## 5. Where things live (orientation map)

| Concern | Files |
|---|---|
| Supabase clients | `src/lib/supabase.ts` (browser anon / request-scoped RLS / memoized service-role) |
| Roles & user gate | `src/lib/roles.ts` (+ `route-helpers.ts` for responses) |
| Ops/admin token gates | server `adminGate.ts`, `admin-auth.ts`; browser `session-token-fetch.ts` + per-surface wrappers |
| Provider failover | `provider.ts` → `provider-keys.ts` → `provider-chain.ts` → `llm.ts` (chat) / `agent/llm-client.ts` (tools) |
| Model registry | `models.ts` (chat picker + role matrix), `agent/model-router.ts` (difficulty tiers) |
| System prompt | `system-prompt.ts` + `*-protocol.ts` blocks |
| GitHub adapters | `github.ts` (constitution), `github-issues.ts`, `github-prs.ts` |
| PR gate logic | `pr-gates.ts` (pure) + `pr-route-helpers.ts` (I/O + audit) |
| Marker extraction | `*-extract.ts` (two-pass: permissive strip, strict parse) |
| Agent | `agent/{model-router,run-service,orchestrator,loop,tools,sandbox*,agent-runs}.ts` |
| Push | `push-server.ts` / `push-client.ts` + service worker |
