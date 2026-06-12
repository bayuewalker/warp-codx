# WARP CodX

A Replit-style AI coding assistant — chat with an agent that helps you write,
review, debug, and reason about code. Multi-user, multi-provider, and
self-hostable on fly.io.

Live: **https://warp-codx.fly.dev**

## Features

- **Multi-provider LLM with auto-switch** — OpenRouter, OpenAI, and Blackbox
  (all OpenAI-compatible). Chat tries configured keys in priority order and
  automatically falls over to the next provider when one is out of credit,
  rate-limited, or has an invalid key.
- **Roles** — `admin` and `user`. Admins are defined by the `ADMIN_EMAILS` env
  var and can manage provider API keys at runtime from **Settings → Admin**.
- **Custom instructions** — always-on guidance injected into every chat.
- **Memory** — durable facts about you. Add them manually, or let the assistant
  auto-capture them from conversations (auto entries land as *pending* for your
  review before they go active).
- **Skills** — install Claude-style `SKILL.md` modules (with optional
  `name` / `description` / `triggers` frontmatter). Enabled skills are
  advertised every turn; a skill's full body is injected only when your message
  matches its name or triggers.
- **Streaming chat** with rich markdown/code rendering, sessions, and optional
  Web Push notifications.
- **IDE workspace (Replit-style)** — a persistent per-user sandbox you can see
  and touch: a lazy file-tree explorer, a code editor (save with ⌘/Ctrl-S), a
  terminal, and a **live preview webview** that proxies your dev server's port
  into an iframe. Toggle between **Chat** and **Code** in the top bar (or via
  ⌘K → *Open workspace*). Built on the same Daytona backend as the coding agent,
  but the box is kept alive and reconnectable across sessions instead of being
  torn down. Requires `DAYTONA_API_KEY`; admin-gated while it's cost-metered.
  Routes live under `src/app/api/workspace/*`; the lifecycle service is
  `src/lib/agent/workspace.ts`.

The chat system prompt is composed at runtime from a neutral base identity plus
your custom instructions, active memory, and enabled skills
(`src/lib/system-prompt.ts`).

## Tech stack

- **Next.js 14** (App Router, standalone output) + React 18 + TypeScript
- **Supabase** — Postgres (sessions, messages, settings, memory, skills,
  provider keys, profiles) + Auth (email magic link) + Realtime
- **OpenAI SDK** pointed at the active provider's OpenAI-compatible endpoint
- **Tailwind CSS**, **Vitest** for tests
- Deployed on **fly.io** via Docker

## Project layout

```
src/
  app/
    api/
      chat/                 # streaming chat endpoint (auto-switch failover)
      settings/             # custom instructions
      memory/  [id]/        # memory CRUD (+ approve/archive)
      skills/  [id]/        # skill install / toggle / delete
      admin/provider-keys/  # admin-only API key management
      me/                   # signed-in user + role
      config/               # runtime public config (Supabase URL/key, provider/model)
    auth/callback/          # magic-link landing → finalizes session
    sign-in/                # email magic-link sign-in
  lib/
    provider.ts             # provider specs, env-key resolution (+ aliases)
    provider-chain.ts       # ordered candidate chain (DB keys → env fallback)
    provider-keys.ts        # admin-managed keys (server-only, masked to client)
    llm.ts                  # openChatStream / createCompletion with failover
    models.ts               # per-provider model matrix + LLM_MODEL override
    system-prompt.ts        # composes the chat system prompt
    settings.ts memory.ts skills.ts roles.ts
    supabase.ts             # browser + server Supabase clients
db/migrations/              # SQL migrations (also mirrored in supabase.sql)
```

## Getting started (local)

```bash
npm install
cp .env.example .env        # fill in the values below
npm run dev                 # http://localhost:5000
npm test                    # vitest
npm run build               # production build (pinned to NODE_ENV=production)
```

### Database

Apply the SQL in `supabase.sql` (or the files under `db/migrations/`) to your
Supabase project — via the SQL editor or the Supabase CLI. Tables are created
with `if not exists`, so it's safe to re-run.

## Environment variables

Only the selected provider's key is strictly required; the rest enable more
features. See `.env.example` for the full list.

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `openrouter` (default) / `openai` / `blackbox` — env fallback when no DB keys exist |
| `LLM_MODEL` | Optional: force one model across all providers |
| `OPENROUTER_API_KEY` | OpenRouter key (alias: `OPEN_ROUTER_API_KEY`) |
| `OPENAI_API_KEY` | OpenAI key (alias: `OPENAI_API`) |
| `BLACKBOX_API_KEY` | Blackbox key |
| `ADMIN_EMAILS` | Comma-separated admin emails (get the Admin panel) |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (server only) |
| `GITHUB_PAT`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` | GitHub PR/issue features |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (used in attribution headers) |

Admin-managed provider keys (added in the UI) live in the `provider_keys` table
and take priority over env keys; env keys remain a fallback.

## Authentication

Sign-in is passwordless (Supabase email magic link). The link returns the user
to `/auth/callback`, which finalizes the session and redirects to the app.

> **Supabase dashboard setup (required):** under **Authentication → URL
> Configuration**, set **Site URL** to your deployed origin
> (`https://warp-codx.fly.dev`) and add it to **Redirect URLs** (e.g.
> `https://warp-codx.fly.dev/**`). Without this, magic links redirect to the
> wrong host.

## Deploy (fly.io)

```bash
fly secrets set \
  ADMIN_EMAILS="you@example.com" \
  OPENROUTER_API_KEY="sk-or-..." \
  OPENAI_API_KEY="sk-..." \
  BLACKBOX_API_KEY="..." \
  # Supabase + GitHub secrets as above
fly deploy
```

The repo's `Dockerfile` is a standard multi-stage Next.js build and works with
Fly's remote builder or any CI with Docker + normal network access.

## Testing

```bash
npm test            # vitest run
npx tsc --noEmit    # typecheck
```
