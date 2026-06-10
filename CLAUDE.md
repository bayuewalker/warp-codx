# CLAUDE.md

Guidance for Claude/agents working in this repo. Keep changes minimal, typed,
and tested. See `README.md` for the product/setup overview.

## What this is

A Replit-style multi-user AI coding assistant. Next.js 14 (App Router,
`output: standalone`) + Supabase + an OpenAI-compatible LLM layer. Deployed on
fly.io as `warp-codx` (https://warp-codx.fly.dev).

## Commands

- `npm run dev` — local dev on :5000
- `npm test` / `npx tsc --noEmit` — tests + typecheck (run both before pushing)
- `npm run build` — production build (pinned to `NODE_ENV=production`; do not
  remove that pin — building with `NODE_ENV=development` bundles the dev React
  runtime and crashes prerender with `useContext` null)

## Architecture notes

- **LLM layer**: never call the OpenAI SDK directly from routes. Use
  `openChatStreamWithFailover` / `createCompletionWithFailover` in
  `src/lib/llm.ts`. They walk `resolveProviderChain()` (`provider-chain.ts`):
  enabled DB keys (`provider_keys`, by priority) first, then env keys as
  fallback, and auto-switch on credit/quota/auth errors (`isCreditError`).
- **Providers**: `src/lib/provider.ts`. Env-key names accept aliases
  (`OPENROUTER_API_KEY`/`OPEN_ROUTER_API_KEY`, `OPENAI_API_KEY`/`OPENAI_API`).
  Per-provider model defaults + `LLM_MODEL` override in `models.ts`.
- **System prompt**: composed in `src/lib/system-prompt.ts` from a neutral base
  + custom instructions + active memory + enabled skills. Each block degrades
  independently — a missing Supabase table must never break a chat turn (all
  read helpers swallow errors and return safe defaults).
- **Roles**: `src/lib/roles.ts`. Admin is decided by `ADMIN_EMAILS` (env wins);
  `requireUser` / `requireAdmin` gate routes. Admin-only endpoints live under
  `/api/admin/*`. `provider_keys` raw values are NEVER sent to the browser
  (use `toPublic` / `maskKey`).
- **Supabase**: server routes use the service-role client (`getServerSupabase`,
  bypasses RLS). The browser uses the anon client (`getBrowserSupabase`) with
  `persistSession: true` + `detectSessionInUrl`. Runtime public config is
  served by `/api/config` (fly.io doesn't bake `NEXT_PUBLIC_*` at build time).
- **Auth**: passwordless magic link. Sign-in is `/sign-in`; the email link
  lands on `/auth/callback` (finalizes the session, redirects to `/`).
  `emailRedirectTo` uses `window.location.origin` — the deployed origin must be
  in the Supabase **Redirect URLs** allow-list and **Site URL**.

## Conventions

- TypeScript strict. Match the surrounding code's comment density and idiom
  (existing files are heavily commented with the "why").
- Add/adjust Vitest tests for new logic; mock module deps with `vi.hoisted`
  (top-level `const` + `vi.mock` factory will fail hoisting).
- DB changes: add a migration in `db/migrations/NNNN-*.sql` AND mirror the
  table defs in `supabase.sql` (idempotent `create ... if not exists`).
- Data model is currently **single-tenant** for sessions/messages (no
  per-user `user_id` scoping yet). Per-user isolation (RLS + Realtime auth) is
  the known next step — see the RLS advisor on `sessions`/`messages`.

## Deploy

`Dockerfile` is a standard multi-stage Next build. Use Fly's remote builder or
CI with Docker. Apply pending `db/migrations/*` to Supabase before/with deploy.
After changing `ADMIN_EMAILS` or provider keys, `fly deploy` (or
`fly secrets set`) to roll them out.
