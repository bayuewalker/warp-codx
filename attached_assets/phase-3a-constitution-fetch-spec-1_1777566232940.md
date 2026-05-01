# PHASE 3a — Constitution Auto-Fetch

> **Spec version:** 1.0
> **Date locked:** 2026-04-30
> **Branch target:** `WARP/constitution-fetch`
> **Validation tier:** MAJOR (touches CMD persona injection + GitHub auth)
> **Dispatch to:** Replit Agent (Claude Sonnet 4.6)

---

## OBJECTIVE

Replace hardcoded SYSTEM_PROMPT in `/api/chat` with **runtime fetch** of WalkerMind OS constitution files from `bayuewalker/walkermind-os` repo. CMD persona, rules, and project state become single-source-of-truth at the repo, not in code.

**Success metric:** When Mr. Walker pushes update to AGENTS.md / COMMANDER.md / PROJECT_STATE.md → next CMD response (within 5 minutes) reflects the change without code redeploy.

---

## ARCHITECTURE DECISIONS (LOCKED)

| ID | Decision | Choice |
|---|---|---|
| Q1 | Fetch scope | **Tiered** — core 4 always + others on-demand |
| Q2 | Cache strategy | **Hybrid** — 5 min TTL with manual refresh |
| Q3 | Fallback policy | **Last cached + soft warning** |
| Q4 | Size guards | **No limit (Phase 3a)** — monitor only |
| Q5 | PAT scope | **`contents:read` only** (Phase 3a baseline) |

---

## SCOPE

### Files always loaded (Tier 1 — every session)

Fetched from `bayuewalker/walkermind-os`:

1. `AGENTS.md` (repo root) — global rules, validation tiers, branch format
2. `docs/COMMANDER.md` — WARP🔹CMD persona + operating reference
3. `PROJECT_REGISTRY.md` (repo root) — active project navigation
4. `{PROJECT_ROOT}/state/PROJECT_STATE.md` — current operational truth (auto-resolved from REGISTRY's CURRENT FOCUS section)

**Estimated total size:** ~30-50KB (well within token budget for gpt-4o or claude-sonnet-4.5).

### Files loaded on-demand (Tier 2 — when CMD context requires)

CMD detects intent from user directive, then fetches additional context if relevant:

| File | Triggered by user message containing |
|---|---|
| `{PROJECT_ROOT}/state/ROADMAP.md` | "phase", "milestone", "roadmap", "ship", "deliverable" |
| `{PROJECT_ROOT}/state/WORKTODO.md` | "task", "todo", "work item", "priority" |
| `{PROJECT_ROOT}/state/CHANGELOG.md` | "history", "what changed", "recent commit" |
| `docs/KNOWLEDGE_BASE.md` | "architecture", "infra", "API", "convention" |
| `docs/blueprint/{project}.md` | "blueprint", "target architecture" |
| `{PROJECT_ROOT}/reports/forge/*` | "last build", "forge report" |
| `{PROJECT_ROOT}/reports/sentinel/*` | "validation", "audit", "sentinel" |

**Implementation:** Pre-process user message with simple keyword regex. If trigger matches, fetch matching file(s) and append to context. Don't pre-fetch speculatively.

### Out of scope (Phase 3a)

- Issue creation (Phase 3b)
- PR webhook + auto-review (Phase 3c)
- Push notifications (Phase 4)
- Multi-project switching from UI (deferred — REGISTRY's `CURRENT FOCUS` field is single source for now)
- Constitution write operations (Phase 3a is read-only)

---

## CACHING STRATEGY (Q2 = Hybrid 5min TTL)

**Cache layer:** Supabase table `constitution_cache` (server-side, shared across users — single-tenant for now).

```sql
create table constitution_cache (
  path text primary key,                    -- e.g. "AGENTS.md"
  content text not null,
  sha text not null,                        -- GitHub SHA for change detection
  fetched_at timestamptz not null default now(),
  size_bytes int not null
);

-- Track fetch metrics for observability
create table constitution_fetch_log (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  status text not null check (status in ('hit_cache', 'miss_fetch', 'error_fallback')),
  duration_ms int,
  error_message text,
  fetched_at timestamptz not null default now()
);

create index idx_fetch_log_recent on constitution_fetch_log (fetched_at desc);
```

**Cache logic per path:**

```
1. Read constitution_cache row WHERE path = X
2. IF row exists AND (now() - fetched_at) < 5 minutes:
     → use cached content (status: hit_cache)
3. ELSE:
     → fetch fresh from GitHub (status: miss_fetch)
     → upsert to constitution_cache
4. IF GitHub fetch fails:
     → use cached content if exists (status: error_fallback)
     → if no cache, use HARDCODED_FALLBACK_PROMPT
```

**Manual refresh:** User can issue `/refresh constitution` slash command (Phase 3a includes this). Bypasses cache, force-fetches all Tier 1 files.

**TTL rationale:** 5 min sweet spot between freshness (typical edit-and-test loop) and cost (fetching 4 files on every message = 200+ GitHub API calls/hr per active user). Single user @ 5 min = ~12 GitHub calls/hr at peak.

---

## FALLBACK POLICY (Q3 = Last cached + soft warning)

**Failure modes:**

| Failure | Response | User-facing indicator |
|---|---|---|
| GitHub API 5xx | Use cached version if exists | Banner: "Constitution from {age}m ago — GitHub temporarily unreachable" |
| GitHub API 401 (PAT expired) | Use cached version + alert | Banner: "Constitution PAT expired — using cached version. Renew in Settings." |
| GitHub API 404 (file deleted) | Use cached version + log drift | Banner: "File X not found in repo — using last known version" |
| No cache + API down | Use HARDCODED_FALLBACK_PROMPT | Banner: "Operating in safe-default mode" |
| Rate limit (5000/hr authenticated) | Wait + retry once | Silent (logged) |

**HARDCODED_FALLBACK_PROMPT** (in code, last resort only):

```typescript
const FALLBACK_SYSTEM_PROMPT = `You are WARP🔹CMD (WARP Commander), the director agent of WalkerMind OS.

You orchestrate WARP•FORGE (build), WARP•SENTINEL (review), and WARP•ECHO (report).

Branch format: WARP/{feature-slug} — lowercase, hyphens only, no underscores, no dates.

Be concise and directive-ready. Always specify which agent should handle a task.

NOTE: Operating in safe-default mode. Constitution unavailable. Recommend Mr. Walker check Settings → Constitution status.`
```

**Banner UI:** Render as warning toast at top of chat area. Color: amber (warning, not red error). Dismissible. Re-appears on next failure.

---

## SIZE GUARDS (Q4 = Monitor only Phase 3a)

**No truncation in Phase 3a.** But add observability:

```typescript
// In fetch handler
const sizeBytes = content.length
if (sizeBytes > 50_000) {
  console.warn(`[constitution] Large file fetched: ${path} = ${sizeBytes} bytes`)
}
if (sizeBytes > 100_000) {
  console.error(`[constitution] CRITICAL size: ${path} = ${sizeBytes} bytes — token budget at risk`)
}
```

**Track metrics:**

- Per-fetch size logged to `constitution_fetch_log` table
- Total context size logged per chat completion call
- Dashboard query (Phase 3a includes a simple debug endpoint):

```sql
-- /api/debug/constitution-stats
select
  path,
  avg(duration_ms)::int as avg_ms,
  count(*) filter (where status = 'hit_cache') as cache_hits,
  count(*) filter (where status = 'miss_fetch') as cache_misses,
  count(*) filter (where status = 'error_fallback') as errors
from constitution_fetch_log
where fetched_at > now() - interval '24 hours'
group by path;
```

**Threshold for action:** If any single file exceeds 100KB OR total context exceeds 200KB, log warning and consider Phase 3.5 truncation work.

---

## GITHUB INTEGRATION (Q5 = `contents:read` only)

### PAT setup

**Scope required:** `Contents: Read-only` (fine-grained PAT, scoped to `bayuewalker/walkermind-os` only).

**NOT requested in Phase 3a:**
- ❌ `Issues: Read/Write` (Phase 3b)
- ❌ `Pull Requests: Read/Write` (Phase 3c)
- ❌ `Metadata: Read` (only if needed; default included)

**Setup flow (Replit Agent will guide Mr. Walker):**

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: `WARP CodX — Constitution Read`
3. Repository access: **Only select repositories** → `bayuewalker/walkermind-os`
4. Permissions → Repository permissions:
   - **Contents: Read-only** ✓
5. Generate token → copy `github_pat_...`
6. Add to Replit Secrets: `GITHUB_PAT_CONSTITUTION`

**Why a dedicated PAT (not user OAuth):** Phase 3a is single-tenant (Mr. Walker only). PAT is simpler, no OAuth flow needed. When WARP CodX becomes multi-tenant or public, switch to OAuth — but that's not Phase 3a problem.

### Octokit client

```typescript
// src/lib/github.ts
import { Octokit } from '@octokit/rest'

const octokit = new Octokit({
  auth: process.env.GITHUB_PAT_CONSTITUTION,
  userAgent: 'WARP-CodX/0.1',
  request: { timeout: 10_000 },
})

const REPO = { owner: 'bayuewalker', repo: 'walkermind-os' }

export async function fetchFile(path: string): Promise<{ content: string; sha: string } | null> {
  try {
    const { data } = await octokit.repos.getContent({ ...REPO, path })
    if (Array.isArray(data) || data.type !== 'file') return null
    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    return { content, sha: data.sha }
  } catch (err: any) {
    if (err.status === 404) return null
    throw err
  }
}
```

---

## CONTEXT ASSEMBLY FLOW

When `/api/chat` POST receives a directive:

```
1. Parse user message
   ↓
2. Determine fetch scope:
   - Tier 1 always: AGENTS.md, COMMANDER.md, PROJECT_REGISTRY.md, PROJECT_STATE.md
   - Tier 2 conditional: scan message for trigger keywords → add files
   ↓
3. For each file in scope:
   - Check Supabase cache (TTL 5 min)
   - If miss → fetch from GitHub via Octokit
   - If GitHub fails → fallback to last cached
   - Update cache + log to fetch_log table
   ↓
4. Resolve PROJECT_ROOT from REGISTRY's "CURRENT FOCUS" section
   - Parse: "CrusaderBot — projects/polymarket/polyquantbot"
   - PROJECT_ROOT = "projects/polymarket/polyquantbot"
   ↓
5. Assemble system prompt:
   - Base persona from COMMANDER.md
   - Append AGENTS.md as "GLOBAL RULES (authoritative)"
   - Append PROJECT_REGISTRY.md as "ACTIVE PROJECTS"
   - Append PROJECT_STATE.md as "CURRENT OPERATIONAL TRUTH"
   - Append Tier 2 fetched files (if any) as "ADDITIONAL CONTEXT"
   ↓
6. Call OpenRouter with assembled system prompt + chat history
   ↓
7. Stream response back to user
   ↓
8. If any fetch had error_fallback status → send banner event to client via Realtime
```

### Reference implementation

```typescript
// src/lib/constitution.ts
import { fetchFile } from './github'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const TIER_1_PATHS = [
  'AGENTS.md',
  'docs/COMMANDER.md',
  'PROJECT_REGISTRY.md',
] as const

const TIER_2_TRIGGERS: Array<{ pathTemplate: string; keywords: RegExp }> = [
  { pathTemplate: '{root}/state/ROADMAP.md',   keywords: /\b(phase|milestone|roadmap|ship|deliverable)\b/i },
  { pathTemplate: '{root}/state/WORKTODO.md',  keywords: /\b(task|todo|work\s+item|priority)\b/i },
  { pathTemplate: '{root}/state/CHANGELOG.md', keywords: /\b(history|changed|recent\s+commit)\b/i },
  { pathTemplate: 'docs/KNOWLEDGE_BASE.md',    keywords: /\b(architecture|infra|api|convention)\b/i },
]

const TTL_MS = 5 * 60 * 1000  // 5 minutes

type CacheRow = { path: string; content: string; sha: string; fetched_at: string }

async function getCached(path: string): Promise<CacheRow | null> {
  const { data } = await supabase
    .from('constitution_cache')
    .select('*')
    .eq('path', path)
    .single()
  return data
}

async function upsertCache(path: string, content: string, sha: string) {
  await supabase.from('constitution_cache').upsert({
    path, content, sha,
    fetched_at: new Date().toISOString(),
    size_bytes: content.length,
  })
}

async function logFetch(
  path: string,
  status: 'hit_cache' | 'miss_fetch' | 'error_fallback',
  durationMs: number,
  errorMessage?: string,
) {
  await supabase.from('constitution_fetch_log').insert({
    path, status, duration_ms: durationMs, error_message: errorMessage,
  })
}

export async function getConstitutionFile(
  path: string,
  forceRefresh = false,
): Promise<{ content: string; status: 'hit_cache' | 'miss_fetch' | 'error_fallback' }> {
  const start = Date.now()

  // 1. Check cache
  if (!forceRefresh) {
    const cached = await getCached(path)
    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime()
      if (age < TTL_MS) {
        await logFetch(path, 'hit_cache', Date.now() - start)
        return { content: cached.content, status: 'hit_cache' }
      }
    }
  }

  // 2. Cache miss or expired → fetch fresh
  try {
    const fresh = await fetchFile(path)
    if (!fresh) {
      // File doesn't exist on GitHub — fall back to cache if any
      const cached = await getCached(path)
      if (cached) {
        await logFetch(path, 'error_fallback', Date.now() - start, '404 — using cached')
        return { content: cached.content, status: 'error_fallback' }
      }
      throw new Error(`File not found: ${path}`)
    }
    await upsertCache(path, fresh.content, fresh.sha)
    await logFetch(path, 'miss_fetch', Date.now() - start)
    return { content: fresh.content, status: 'miss_fetch' }
  } catch (err: any) {
    // 3. GitHub fetch failed → fallback to cache
    const cached = await getCached(path)
    if (cached) {
      await logFetch(path, 'error_fallback', Date.now() - start, err.message)
      return { content: cached.content, status: 'error_fallback' }
    }
    // 4. No cache → throw, caller decides
    await logFetch(path, 'error_fallback', Date.now() - start, err.message)
    throw err
  }
}

export async function resolveProjectRoot(): Promise<string> {
  const { content } = await getConstitutionFile('PROJECT_REGISTRY.md')
  // Parse "CURRENT FOCUS" section: "CrusaderBot — projects/polymarket/polyquantbot"
  const match = content.match(/##\s+CURRENT FOCUS\s*\n\s*(?:[A-Z][\w\s]*?)?\s*[—\-–]\s*([^\n]+)/i)
  if (!match) {
    throw new Error('PROJECT_REGISTRY.md missing or malformed CURRENT FOCUS section')
  }
  return match[1].trim()
}

function detectTier2Files(userMessage: string, projectRoot: string): string[] {
  const matched: string[] = []
  for (const trigger of TIER_2_TRIGGERS) {
    if (trigger.keywords.test(userMessage)) {
      matched.push(trigger.pathTemplate.replace('{root}', projectRoot))
    }
  }
  return matched
}

export async function buildSystemPrompt(userMessage: string): Promise<{
  prompt: string
  warnings: string[]
}> {
  const warnings: string[] = []

  // Always-loaded (Tier 1)
  const tier1Results = await Promise.all([
    getConstitutionFile('AGENTS.md'),
    getConstitutionFile('docs/COMMANDER.md'),
    getConstitutionFile('PROJECT_REGISTRY.md'),
  ])

  const projectRoot = await resolveProjectRoot()
  const projectStateResult = await getConstitutionFile(`${projectRoot}/state/PROJECT_STATE.md`)

  // On-demand (Tier 2)
  const tier2Paths = detectTier2Files(userMessage, projectRoot)
  const tier2Results = await Promise.all(tier2Paths.map(p => getConstitutionFile(p)))

  // Collect warnings from any error_fallback fetches
  const allResults = [...tier1Results, projectStateResult, ...tier2Results]
  const fallbackCount = allResults.filter(r => r.status === 'error_fallback').length
  if (fallbackCount > 0) {
    warnings.push(`${fallbackCount} constitution file(s) using cached version — GitHub partially unreachable`)
  }

  // Assemble
  const sections: string[] = []
  sections.push(`# WARP🔹CMD PERSONA\n\n${tier1Results[1].content}`)  // COMMANDER.md
  sections.push(`# GLOBAL RULES (AUTHORITATIVE)\n\n${tier1Results[0].content}`)  // AGENTS.md
  sections.push(`# ACTIVE PROJECTS\n\n${tier1Results[2].content}`)  // REGISTRY
  sections.push(`# CURRENT OPERATIONAL TRUTH\n\n${projectStateResult.content}`)  // PROJECT_STATE
  if (tier2Results.length > 0) {
    sections.push(`# ADDITIONAL CONTEXT\n\n${tier2Results.map(r => r.content).join('\n\n---\n\n')}`)
  }

  return {
    prompt: sections.join('\n\n═══════════════════════════\n\n'),
    warnings,
  }
}
```

### Update /api/chat handler

```typescript
// src/app/api/chat/route.ts (excerpt — only changed parts)
import { buildSystemPrompt } from '@/lib/constitution'

export async function POST(req: Request) {
  const { sessionId, content } = await req.json()

  // 1. Save user message (existing logic)
  await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content })

  // 2. NEW: Build system prompt from runtime constitution
  let systemPrompt: string
  let warnings: string[] = []
  try {
    const result = await buildSystemPrompt(content)
    systemPrompt = result.prompt
    warnings = result.warnings
  } catch (err) {
    console.error('[constitution] buildSystemPrompt failed:', err)
    systemPrompt = FALLBACK_SYSTEM_PROMPT  // hardcoded last-resort
    warnings = ['Constitution unavailable — operating in safe-default mode']
  }

  // 3. If warnings, broadcast banner event via Supabase Realtime
  if (warnings.length > 0) {
    await supabase.from('chat_warnings').insert({
      session_id: sessionId,
      level: 'warn',
      message: warnings.join('; '),
    })
  }

  // 4. Fetch chat history (existing logic)
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  // 5. Stream from OpenRouter (existing logic, with new systemPrompt)
  const stream = await openai.chat.completions.create({
    model: MODELS.cmd,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(history ?? []).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ],
  })

  // ... rest of streaming logic unchanged
}
```

### Manual refresh endpoint

```typescript
// src/app/api/constitution/refresh/route.ts
import { getConstitutionFile } from '@/lib/constitution'

export async function POST() {
  const paths = ['AGENTS.md', 'docs/COMMANDER.md', 'PROJECT_REGISTRY.md']
  const results = await Promise.all(
    paths.map(p => getConstitutionFile(p, true))  // forceRefresh = true
  )
  return Response.json({
    refreshed: results.length,
    statuses: results.map(r => r.status),
  })
}
```

User can trigger via slash command in chat input: `/refresh constitution` (Phase 3a Replit Agent should add this slash command handler).

---

## UI ADDITIONS

### Constitution status indicator

**Location:** Header context area (when in Sessions view) — small badge showing constitution sync state.

```
WARP / dashboard-ui  [✓ synced 2m ago]
```

**States:**
- `✓ synced 2m ago` — fresh fetch within 5 min, all files OK (teal dot)
- `↻ refreshing` — manual refresh in progress (blue spinner)
- `⚠ stale 12m` — fetch failed, using cached (amber dot)
- `× offline` — no cache + GitHub down (red dot)

**Tap behavior:** Opens bottom sheet with detailed breakdown:

```
CONSTITUTION STATUS

✓ AGENTS.md          1m ago
✓ COMMANDER.md       1m ago
✓ PROJECT_REGISTRY   1m ago
⚠ PROJECT_STATE.md   12m ago — using cache

[ REFRESH NOW ]
```

### Warning banner

When `chat_warnings` table receives new row for active session, render dismissible amber banner above chat:

```
⚠ Constitution from 12m ago — GitHub partially unreachable    [×]
```

Banner auto-clears on next successful fetch.

### Settings → Constitution

New entry in drawer (or settings modal):

```
CONSTITUTION

Repo:           bayuewalker/walkermind-os
PAT scope:      contents:read
Active project: CrusaderBot
PROJECT_ROOT:   projects/polymarket/polyquantbot

Tier 1 files:
  ✓ AGENTS.md           14KB · 2m ago
  ✓ docs/COMMANDER.md   23KB · 2m ago
  ✓ PROJECT_REGISTRY.md  1KB · 2m ago
  ✓ state/PROJECT_STATE  3KB · 2m ago

Cache: 4 entries · 41KB total
TTL: 5 minutes
Last manual refresh: never

[ REFRESH ALL ]
[ CLEAR CACHE ]
[ TEST PAT ]
```

---

## VALIDATION TIER & DELIVERABLES

### Validation tier: **MAJOR**

Reasons:
- Touches CMD persona injection (core behavior)
- Adds new external dependency (GitHub API)
- Adds new auth surface (PAT)
- Adds new Supabase tables (cache + log)
- Changes /api/chat handler critical path

→ Requires WARP•SENTINEL audit after WARP•FORGE PR.

### Branch: `WARP/constitution-fetch`

### Deliverables

**Code:**
- [ ] `src/lib/github.ts` — Octokit wrapper with PAT auth
- [ ] `src/lib/constitution.ts` — fetch + cache + assemble logic
- [ ] `src/app/api/chat/route.ts` — updated handler using `buildSystemPrompt`
- [ ] `src/app/api/constitution/refresh/route.ts` — manual refresh endpoint
- [ ] `src/components/ConstitutionStatus.tsx` — header badge component
- [ ] `src/components/WarningBanner.tsx` — chat warning banner
- [ ] `src/components/ConstitutionSettings.tsx` — settings panel
- [ ] Slash command parser supporting `/refresh constitution`

**Database (Supabase SQL — run before deploy):**

```sql
create table constitution_cache (
  path text primary key,
  content text not null,
  sha text not null,
  fetched_at timestamptz not null default now(),
  size_bytes int not null
);

create table constitution_fetch_log (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  status text not null check (status in ('hit_cache', 'miss_fetch', 'error_fallback')),
  duration_ms int,
  error_message text,
  fetched_at timestamptz not null default now()
);

create index idx_fetch_log_recent on constitution_fetch_log (fetched_at desc);

create table chat_warnings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error')),
  message text not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create index idx_warnings_session on chat_warnings (session_id, created_at);

-- Phase 1 model: RLS disabled
alter table constitution_cache disable row level security;
alter table constitution_fetch_log disable row level security;
alter table chat_warnings disable row level security;

-- Add to realtime
alter publication supabase_realtime add table chat_warnings;
```

**Environment variables:**
- `GITHUB_PAT_CONSTITUTION` (new — fine-grained PAT, contents:read)

**Documentation:**
- `docs/PHASE_3A_NOTES.md` in WARP CodX repo — operational notes for future maintainers

### Done criteria

1. ✅ User sends message → CMD response reflects current AGENTS.md content (verified by editing AGENTS.md, waiting 5min, sending new message)
2. ✅ Cache hit rate > 80% in normal usage (verified via debug stats endpoint after 1 hour usage)
3. ✅ GitHub API failure simulation (revoke PAT temporarily) → CMD continues with cached version + warning banner appears
4. ✅ `/refresh constitution` slash command bypasses cache, force-fetches all Tier 1
5. ✅ Header constitution status badge updates in real-time
6. ✅ Tier 2 fetch triggers correctly when message contains "phase" / "task" / "architecture" / etc.
7. ✅ No regression in Phase 1/1.5/2.5 functionality — all existing tests pass
8. ✅ PROJECT_STATE.md changes propagate within 5 minutes (manual edit → wait 5min → new chat reflects)

### Next gate

After Replit Agent reports done → **WARP•SENTINEL audit** before merge. Specifically check:

- PAT not hardcoded (env var only)
- No silent failures (every fetch path has logging)
- Cache TTL respected (no edge cases where stale > 5min)
- Fallback chain works end-to-end (GitHub down → cache → hardcoded)
- No PII or secrets logged in fetch_log
- Token budget not exploded (test with full Tier 1 + 2 — measure tokens)
- Race conditions: concurrent /api/chat calls don't double-fetch same path within TTL

---

## ESTIMATED IMPACT

**Token cost per directive:**
- Phase 1 baseline: ~500 tokens system prompt + history
- Phase 3a: ~12,000 tokens system prompt (Tier 1 cached) + history
- 24x increase per call

**Mitigation:**
- Cache hit minimizes GitHub API cost (not LLM cost — system prompt still sent)
- Consider prompt caching (OpenRouter supports for some models) in Phase 3.5

**Cost projection (single user, 50 directives/day):**
- Phase 1: ~25k tokens/day @ gpt-4o = $0.06/day
- Phase 3a: ~600k tokens/day @ gpt-4o = $1.50/day = ~$45/month

This is the **price of single source of truth**. Worth it because:
- Constitution updates propagate without redeploy
- CMD always grounded in current repo state
- Eliminates "drift" between code and what CMD thinks the rules are

If cost becomes problem at scale → switch to prompt caching (50% discount on cached portion) or use cheaper model for Tier 2 context.

---

## ROLLOUT PLAN

### Step 1: Mr. Walker prep (5 min)
1. Create fine-grained PAT (`contents:read` only, scoped to `walkermind-os`)
2. Add `GITHUB_PAT_CONSTITUTION` to Replit Secrets

### Step 2: Run SQL migration (1 min)
Mr. Walker pastes SQL block to Supabase SQL Editor → Run

### Step 3: Dispatch to Replit Agent (1 min)
Mr. Walker copies this entire spec doc → pastes to Replit Agent chat → Agent generates plan

### Step 4: Plan review (5 min)
Mr. Walker reviews plan → approve or request modifications (per Phase 1 / 2.5 lessons)

### Step 5: Replit Agent execution (~30-45 min)
Agent implements per spec → tests → reports done

### Step 6: WARP🔹CMD verification (10 min)
Mr. Walker tests acceptance criteria from "Done criteria" list

### Step 7: WARP•SENTINEL audit (separate dispatch, MAJOR tier required)
Audit per "Next gate" checklist → approve / request changes

### Step 8: Merge + ship
After SENTINEL approve → merge `WARP/constitution-fetch` → deploy

---

## RISKS & MITIGATIONS

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PROJECT_REGISTRY parse fails | Low | High (no PROJECT_ROOT) | Add fallback to `projects/polymarket/polyquantbot` (current active) |
| Tier 2 keyword regex over-fires (fetches too much) | Medium | Medium (extra cost) | Monitor fetch_log, tighten regex if hit rate >50% |
| GitHub API rate limit (5000/hr) | Very Low | High (all fetches fail) | Single user can't realistically hit this; add monitoring alert at 80% |
| Cache table grows unbounded | Low | Low | Constitution files are few (~10 files max), cache size bounded |
| Concurrent fetch race condition | Medium | Low | Supabase upsert handles last-write-wins; minor inconsistency tolerable |
| Token budget exceeded | Medium | High (LLM call fails) | Add token estimator before call, warn at 80% of model max |
| Constitution drift between cache and repo | Low | Medium | SHA tracking — if cached SHA doesn't match GitHub, force refresh |

---

## OPEN QUESTIONS (for next session)

1. Should `/refresh constitution` slash command also clear Tier 2 cached files, or only Tier 1?
   - **Recommendation:** Tier 1 only (Tier 2 is on-demand, fetched fresh as needed).

2. Should we add a "constitution version" indicator (last commit SHA) in CMD response footer?
   - **Recommendation:** Defer to Phase 3.5 — minor UX polish.

3. Should Tier 2 keyword detection use embedding similarity instead of regex?
   - **Recommendation:** Defer. Regex is good enough for English+Indonesian mix Mr. Walker uses.

4. What if Mr. Walker switches active project (PROJECT_REGISTRY's CURRENT FOCUS changes mid-session)?
   - **Recommendation:** Phase 3a behavior: PROJECT_ROOT resolved per /api/chat call, so next message uses new project. Document this in PHASE_3A_NOTES.md.

---

## SPEC APPROVAL

**Architecture decisions:** Locked B/C/A/C/A by Mr. Walker on 2026-04-30.

**Ready for dispatch:** YES — spec is complete, all decisions resolved.

**Dispatch instruction:** Mr. Walker copies this file → pastes to Replit Agent → Agent generates plan → Mr. Walker reviews plan → approve → execute.

---

> End of Phase 3a spec
> Next phase blocked on: 3a complete + SENTINEL approval + merge
> See also: Design Decisions v1.0 (UI patterns), warp-codx-mockup-v2-r4.html (visual reference)
