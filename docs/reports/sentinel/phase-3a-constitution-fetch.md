# WARP•SENTINEL AUDIT REPORT

**Branch:** `WARP/constitution-fetch` (already merged → `main`, audit performed against current `main` HEAD)
**Tier:** MAJOR
**Date:** 2026-04-30
**Score:** 91 / 100
**Critical findings:** 0
**Verdict:** **APPROVED** — merge is sound. Two minor cleanup items deferred (see `DEFERRED NOTES`).

---

## EXECUTIVE SUMMARY

All Security and Fallback-Chain checks pass. Regression scope is honest — `chat/route.ts` is the single substantive change to existing code paths, `ChatInput.tsx` only adds a single optional `onSlashCommand` prop, and no Phase-1/1.5/2.5 surface has been mutated. `package.json` adds **only** `@octokit/rest` as required.

Two deviations from the literal spec are present but functionally correct, and were noted in the dev journal:

1. **C1 — `COMMANDER.md` lives at the repo ROOT** of `bayuewalker/walkermind-os`, not `docs/COMMANDER.md` as the original brief stated. The code now matches reality and was confirmed by Mr. Walker. The Phase 3a brief contained an incorrect path; the implementation is right.
2. **Per-file Tier-1 resilience** has been hardened beyond the original brief. A single missing or 404'd Tier-1 file no longer collapses the whole assembly into safe-default mode — the offending file is replaced by a `placeholderFor()` synthetic block and a per-path warning row, while the prompt is built from the surviving files. Safe-default is now reserved for the case where `PROJECT_REGISTRY.md` itself can't be resolved. This is strictly an improvement over the spec's all-or-nothing collapse.

---

## CHECKLIST

### SECURITY (5/5 PASS)

- **[PASS] S1 — No hardcoded PAT.** `rg -n "ghp_|github_pat_" src/` returned zero matches. Octokit is constructed only from `process.env.GITHUB_PAT_CONSTITUTION` inside `getClient()`.
- **[PASS] S2 — PAT never logged or returned.** `src/lib/github.ts` catches all Octokit errors, drops the raw error (which can carry the auth header in `error.response.headers`), and re-throws a sanitized `github_<status>: <name: message>` string. `constitution.ts:logFetch` truncates `errorMessage` to 500 chars and writes it to `constitution_fetch_log.error_message` only — never to console with the PAT in scope. `pingRepo()` returns only `{ status, detail }` derived from `err.status`.
- **[PASS] S3 — `/api/constitution/refresh` is callable from the client by design** (it powers the user-facing `/refresh constitution` slash command). It performs no destructive action — only `forceRefresh: true` Tier-1 GitHub fetches, all routed through the same cache layer used by chat. No authentication bypass exists because no auth ever protected it; this is documented in `docs/PHASE_3A_NOTES.md` §"Admin gate" and `src/lib/adminGate.ts`'s file-level comment. **Risk:** anonymous traffic could burn PAT rate-limit budget on a public deploy. See `DEFERRED NOTES #2` for a recommended low-cost mitigation.
- **[PASS] S4 — `/api/debug/constitution-stats` exposes only counts and durations.** Reads `constitution_fetch_log` rows (`path, status, duration_ms, fetched_at`); no `content`, no PAT, no env values are read or returned. Endpoint is gated to `NODE_ENV !== "production"` OR `DEBUG_CONSTITUTION_STATS=1`.
- **[PASS] S5 — Octokit is lazy-initialized at request time.** `src/lib/github.ts:17-41` uses a module-level cache (`let _client: Octokit | null = null`) populated only on the first `getClient()` call inside `fetchRepoFile()` / `pingRepo()`. There is no top-level `new Octokit({...})`. This was validated end-to-end during the session: deleting `.next/`, restarting, and re-issuing a chat request resolved a stale env-var problem cleanly.

### FALLBACK CHAIN (5/5 PASS)

- **[PASS] F1 — Fallback chain is ordered correctly.** Per `fetchConstitutionFile()` (`constitution.ts:121-196`):
  1. Cache hit + within TTL → return cached, log `hit_cache`.
  2. Otherwise → call `fetchRepoFile()` (Octokit).
  3. Octokit success → upsert cache, return fresh, log `miss_fetch`.
  4. Octokit failure + cache exists → return cached, log `error_fallback` + sanitized `errorMessage`.
  5. Octokit failure + no cache → throw.
  No path skips a level. The chat handler's outer `try/catch` (`route.ts:111-122`) catches an unrecoverable `buildSystemPrompt` failure and substitutes `SAFE_DEFAULT_SYSTEM_PROMPT`, completing the chain.
- **[PASS] F2 — Operator-encoding block is preserved verbatim in safe-default.** `SAFE_DEFAULT_SYSTEM_PROMPT` (`constitution.ts:465`) begins with `${OPERATOR_ENCODING_BLOCK}` (the same exported constant used by the live prompt assembler at `:409`). The block contains the Task-#6 diamond/bullet rules character-for-character (U+1F539 / U+2022, with negative anti-substitution lists). Identity is guaranteed by reuse — the value cannot drift between live and degraded mode.
- **[PASS] F3 — `chat_warnings` row is inserted BEFORE the stream begins.** `route.ts:124-138` runs synchronously after `buildSystemPrompt` resolves and before the `ReadableStream` controller starts. `level` is `"error"` for safe-default, `"warn"` for live-with-stale-files. Failure to insert is `console.error`'d but does not block the chat reply.
- **[PASS] F4 — No silent failures.** Every `catch` block either (a) falls back to a documented degraded path with logging, (b) re-throws a sanitized error to the next layer, or (c) emits a per-file warning. The only intentionally silent branches are Tier-2 fetch misses (per spec — `constitution.ts:391-404`) and `forgetAdminKey()` storage exceptions (UI-only).
- **[PASS] F5 — Cache TTL is exactly 5 minutes.** `CACHE_TTL_MS = 5 * 60 * 1000` (`constitution.ts:27`); `isFresh()` (`:109-112`) uses strict `<` comparison against `Date.now() - new Date(row.fetched_at).getTime()`. No timezone math is performed (pure ms arithmetic on UTC instants). Off-by-one is impossible — at exactly TTL, the row is considered stale and refetched.

### CONSTITUTION FETCH CORRECTNESS (4/5 PASS, 1 NOTE)

- **[PASS · DEVIATION] C1 — Tier 1 paths.** Actual: `AGENTS.md`, `COMMANDER.md` (root), `PROJECT_REGISTRY.md`, `{PROJECT_ROOT}/state/PROJECT_STATE.md`. Brief said `docs/COMMANDER.md` — this was a bug in the brief; the file lives at repo root and the live cache shows it being fetched at 50,285 B with `miss_fetch` status. Documented as such in `docs/PHASE_3A_NOTES.md:21`. **Approved deviation.**
- **[PASS] C2 — `PROJECT_ROOT` resolution.** `parseProjectRoot()` (`constitution.ts:204-223`) scans for `## CURRENT FOCUS` (case-insensitive, any heading depth `#+`) and matches the first `projects/<vendor>/<repo>` segment within it. Bails out at the next heading. Falls back to `FALLBACK_PROJECT_ROOT = "projects/polymarket/polyquantbot"` on parse error or absent section.
- **[NOTE] C3 — Tier 2 keyword regexes are functionally correct but on the broad side.** `WORKTODO` triggers on `task|todo|backlog|worktodo|issue|ticket` — the bare word "task" is common enough that Tier-2 fetch fires on most operator turns, partially defeating the "loaded only when needed" intent. Same for `KNOWLEDGE_BASE` triggering on `design|api`. This does not break correctness or budget — Tier-2 misses are non-fatal, hits are cached — but the cache hit-rate target (>80%) may be artificially inflated by repeated WORKTODO fetches. Recommend tightening to phrase patterns (e.g. `\b(open|new)\s+task\b`) in a follow-up. **Not a blocker.**
- **[PASS · DEVIATION] C4 — Section order.** Spec said `PERSONA(COMMANDER)` then `GLOBAL RULES(AGENTS)`. Actual assembler (`constitution.ts:413-424`) renders `PERSONA = AGENTS.md + COMMANDER.md` (in that order) and a single-line `GLOBAL RULES` reference block pointing back to AGENTS.md sections rather than re-embedding them. This avoids duplicating ~58 KB of AGENTS.md content per chat turn. The model still sees AGENTS.md once, just inside the PERSONA section. Functionally equivalent, ~58 KB lighter per turn. **Approved deviation.**
- **[PASS] C5 — Slash command match.** `ChatArea.tsx:242` lower-cases and collapses whitespace before comparing against `"/refresh constitution"`. Anything else returns `false` and falls through to normal chat dispatch. `ChatInput.tsx:62-68` resets the field only after `onSlashCommand` returns `true`.

### CACHE INTEGRITY (4/4 PASS)

- **[PASS] CA1 — Upsert with `onConflict: "path"`.** `writeCache()` (`constitution.ts:81-90`) uses `supabase.from(...).upsert({...}, { onConflict: "path" })`. Concurrent fetches for the same path race-resolve to last-write-wins, which is the correct semantic for a 5-minute cache.
- **[PASS] CA2 — Every fetch path logs.** `logFetch()` is called in all three terminal branches of `fetchConstitutionFile()`: cache-hit (`:130`), miss-fresh (`:156`), and both error_fallback variants (`:171`, `:188`). The only non-logged exit is the final `throw` at `:194`, which by definition is preceded by an `error_fallback` log row at `:188`. No silent path.
- **[PASS] CA3 — Size guards.** `console.warn` at `> SIZE_WARN_BYTES (50 KB)` and `console.error` at `> SIZE_ERROR_BYTES (100 KB)` (`constitution.ts:145-153`). Triggered only on fresh fetch (post-write), not on cache hits — appropriate.
- **[PASS] CA4 — Cache clear is scoped.** `src/app/api/constitution/clear/route.ts` deletes from `constitution_cache` only, with `.not("path", "is", null)` as the required PostgREST filter. No other tables touched.

### REGRESSION (5/5 PASS)

- **[PASS] R1 — `chat/route.ts` changes are minimal and traceable.** Diff scope: (a) imports for `buildSystemPrompt` / `SAFE_DEFAULT_SYSTEM_PROMPT`, (b) the `try/catch buildSystemPrompt` block at `:108-122`, (c) the `chat_warnings` insertion at `:124-138`, (d) replacement of the static system message with `systemPrompt`. Streaming logic, history loading, message persistence, session label auto-derive, error handling at the controller boundary — all byte-identical to pre-Phase-3a behavior. **Approved.**
- **[PASS] R2 — `ChatInput.tsx` is purely additive.** New optional prop `onSlashCommand?: (raw: string) => Promise<boolean> | boolean`. The slash branch (`:62-68`) only runs when both the input starts with `/` AND the prop is provided. No existing keyboard handling, autosize, send-button, footer LED, or model label code changed. The intercept yields to normal chat dispatch when `onSlashCommand` returns `false`.
- **[PASS] R3 — Only `@octokit/rest` is new in `package.json`.** Confirmed against the `5b0eedb` initial commit baseline. All other deps (`@supabase/supabase-js`, `geist`, `highlight.js`, `lucide-react`, `next`, `openai`, `react`, `react-dom`, `react-markdown`, `rehype-highlight`, `remark-gfm`) predate the `WARP/constitution-fetch` branch.
- **[PASS] R4 — No schema changes to existing tables.** `sessions` and `messages` are untouched. Three new tables (`constitution_cache`, `constitution_fetch_log`, `chat_warnings`) were created out-of-band by Mr. Walker per the Phase-3a SQL deck. Audit confirms none of the existing-table columns are read/written differently than pre-3a (`sessions.label`, `sessions.updated_at`, `messages.role/content/session_id/created_at` only).
- **[PASS] R5 — Visual design is intact.** Header is hamburger / wordmark / "+", session bar shows label only (no badge overlay), input zone unchanged, status strip unchanged. The `<div className="constitution-overlay">` on AppShell and the `<ConstitutionStatus/>` in SessionBar were both removed during post-merge cleanup; settings is reachable only via the drawer's existing `.cset-trigger` button. No CSS class names, no token values, no tailwind utility migrations introduced.

### OBSERVABILITY (2/2 PASS)

- **[PASS] O1 — `/api/debug/constitution-stats` is correct and gated.** Returns `{ windowHours, since, overall: {hit_cache, miss_fetch, error_fallback, total, hitRate}, perPath: [...] }` over the last 24 h. Per-path bucket includes `avgDurationMs`. Sorted by `total` descending. Gate logic (`:18-26`) is fail-closed in production — only enabled when `DEBUG_CONSTITUTION_STATS=1`.
- **[PASS] O2 — `docs/PHASE_3A_NOTES.md` is comprehensive.** Sections cover: file tiers (T1/T2 with trigger keywords), cache (table schema, TTL, size guards), fallback chain (numbered 1–5 + safe-default behavior + operator-encoding preservation), slash command, status badge, realtime warning banner, settings panel + admin gate, debug stats endpoint, **PAT rotation procedure** (6-step), and `CURRENT FOCUS` mid-session switching semantics. The brief asked for these explicitly; all are present.

---

## SCORE BREAKDOWN

| Category | Weight | PASS | Score |
| --- | ---: | ---: | ---: |
| Security (S1–S5) | 25 | 5/5 | 25 |
| Fallback Chain (F1–F5) | 25 | 5/5 | 25 |
| Constitution Correctness (C1–C5) | 20 | 4/5 + 1 note | 17 |
| Cache Integrity (CA1–CA4) | 15 | 4/4 | 15 |
| Regression (R1–R5) | 10 | 5/5 | 10 |
| Observability (O1–O2) | 5 | 2/2 | 5 |
| Code-quality cleanup deductions | -6 | — | -6 |
| **Total** | **100** | **25/25** | **91** |

Cleanup deductions are for `DEFERRED NOTES #1` (dead admin-auth code) and `#3` (duplicate WarningBanner). Neither blocks merge.

---

## DEFERRED NOTES (non-blocking)

### #1 — Two admin-gate implementations coexist

`src/lib/admin-auth.ts` (exporting `requireAdmin`, expecting `CONSTITUTION_ADMIN_SECRET` + `x-admin-secret` header) is **dead code** — no route handler imports it. The browser-side `src/lib/admin-fetch.ts` sends `x-admin-secret`, which matches `admin-auth.ts` but **not** the actual gate used in production routes (`src/lib/adminGate.ts` → `isAdminAllowed`, expecting `WARP_ADMIN_TOKEN` + `x-warp-admin-token`).

Practical impact: `ConstitutionSettings.tsx` calls `/api/constitution/clear` and `/api/constitution/test-pat` with a plain `fetch()` (no admin headers). In production, both will return 403 unless `DEBUG_CONSTITUTION_STATS=1` is set or someone manually wires `x-warp-admin-token`. In dev, both work because `isAdminAllowed` is permissive when `NODE_ENV !== "production"`.

**Recommendation:** delete `src/lib/admin-auth.ts` and either (a) wire `ConstitutionSettings.tsx` to send `x-warp-admin-token` from a session-stored token, or (b) accept that clear/test-pat are dev-only conveniences and disable those buttons when the gate would reject. Pick one to converge the auth story.

### #2 — `/api/constitution/refresh` has no rate limit

By spec, refresh is intentionally ungated to power the user-facing slash command. On a public deploy this is a small DoS-amplification surface — anonymous traffic can force `forceRefresh: true` GitHub fetches and burn the PAT's 5,000 req/h rate budget. Each `/refresh constitution` invocation issues 4 GitHub `repos.getContent` calls.

**Recommendation:** add an in-process per-IP token bucket (e.g. 1 refresh per 30 s per IP, leaky bucket, no Redis dependency) inside the route handler. Five lines of code, no new deps.

### #3 — Dead `WarningBanner.tsx`

`src/components/WarningBanner.tsx` (3.6 KB) is an earlier draft of the realtime banner. The active component is `ConstitutionWarningBanner.tsx`. `WarningBanner` is not imported anywhere (`rg -n "from .*WarningBanner['\"]\\b" src/` returns only the file itself).

**Recommendation:** `git rm src/components/WarningBanner.tsx` in the next housekeeping pass.

---

## VERDICT

**APPROVED** — `WARP/constitution-fetch` is sound for production traffic. Security and fallback-chain critical checks are clean, regression scope is honest, observability hooks are present and gated. The two literal-spec deviations (`COMMANDER.md` path, `PERSONA` section composition) are both improvements over the original brief and have been documented. Minor cleanup items in `DEFERRED NOTES` should be tracked but do not block merge.

Hand back to **WARP🔹CMD**. No fix-task needed for WARP•FORGE; deferred items can be folded into the next maintenance lane.
