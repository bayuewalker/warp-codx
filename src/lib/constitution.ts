/**
 * Constitution fetch + cache layer (Phase 3a).
 *
 * Replaces the hardcoded WARP🔹CMD system prompt with a runtime-built prompt
 * sourced from `bayuewalker/walkermind-os`:
 *
 *   Tier 1 (always loaded):
 *     - AGENTS.md
 *     - COMMANDER.md (repo root)
 *     - PROJECT_REGISTRY.md
 *     - {project_root}/state/PROJECT_STATE.md
 *
 *   Tier 2 (loaded only when the user's message matches per-file keywords):
 *     - {project_root}/state/ROADMAP.md
 *     - {project_root}/state/WORKTODO.md
 *     - {project_root}/state/CHANGELOG.md
 *     - docs/KNOWLEDGE_BASE.md
 *
 * Each fetch is cache-first against the `constitution_cache` Supabase table
 * with a 5-minute TTL. On GitHub failure we fall back to the last cached
 * version; if nothing is cached we throw and the caller drops to a
 * hardcoded safe-default prompt.
 */
import { fetchRepoFile, CONSTITUTION_REPO } from "./github";
import { getServerSupabase } from "./supabase";

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const SIZE_WARN_BYTES = 50 * 1024;
export const SIZE_ERROR_BYTES = 100 * 1024;
export const FALLBACK_PROJECT_ROOT = "projects/polymarket/polyquantbot";

export const TIER1_PATHS_GLOBAL = [
  "AGENTS.md",
  "COMMANDER.md",
  "PROJECT_REGISTRY.md",
] as const;

export type FetchStatus = "hit_cache" | "miss_fetch" | "error_fallback";

export type ConstitutionFile = {
  path: string;
  content: string;
  sha: string;
  sizeBytes: number;
  fetchedAt: string;
  status: FetchStatus;
  errorMessage?: string;
};

export type Tier2Match = {
  path: string;
  reason: string;
};

type CacheRow = {
  path: string;
  content: string;
  sha: string;
  size_bytes: number;
  fetched_at: string;
};

async function readCache(path: string): Promise<CacheRow | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("constitution_cache")
    .select("path, content, sha, size_bytes, fetched_at")
    .eq("path", path)
    .maybeSingle();
  if (error) return null;
  return (data as CacheRow) ?? null;
}

async function writeCache(file: {
  path: string;
  content: string;
  sha: string;
  sizeBytes: number;
}): Promise<void> {
  const supabase = getServerSupabase();
  await supabase.from("constitution_cache").upsert(
    {
      path: file.path,
      content: file.content,
      sha: file.sha,
      size_bytes: file.sizeBytes,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "path" },
  );
}

async function logFetch(opts: {
  path: string;
  status: FetchStatus;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  // error_message is sanitized by the caller — never includes the PAT.
  await supabase.from("constitution_fetch_log").insert({
    path: opts.path,
    status: opts.status,
    duration_ms: Math.max(0, Math.round(opts.durationMs)),
    error_message: opts.errorMessage ?? null,
  });
}

function isFresh(row: CacheRow): boolean {
  const age = Date.now() - new Date(row.fetched_at).getTime();
  return age < CACHE_TTL_MS;
}

export type FetchOptions = { forceRefresh?: boolean };

/**
 * Cache-first fetch. Returns a ConstitutionFile and writes a fetch_log row.
 * Throws only when both GitHub fails AND no cached row exists — callers
 * are expected to catch and degrade.
 */
export async function fetchConstitutionFile(
  path: string,
  opts: FetchOptions = {},
): Promise<ConstitutionFile> {
  const t0 = Date.now();
  const cached = await readCache(path);

  if (!opts.forceRefresh && cached && isFresh(cached)) {
    const dur = Date.now() - t0;
    await logFetch({ path, status: "hit_cache", durationMs: dur });
    return {
      path,
      content: cached.content,
      sha: cached.sha,
      sizeBytes: cached.size_bytes,
      fetchedAt: cached.fetched_at,
      status: "hit_cache",
    };
  }

  try {
    const fresh = await fetchRepoFile(path);
    await writeCache({ path, ...fresh });

    if (fresh.sizeBytes > SIZE_ERROR_BYTES) {
      console.error(
        `[constitution] ${path} size ${fresh.sizeBytes}B exceeds ${SIZE_ERROR_BYTES}B`,
      );
    } else if (fresh.sizeBytes > SIZE_WARN_BYTES) {
      console.warn(
        `[constitution] ${path} size ${fresh.sizeBytes}B exceeds ${SIZE_WARN_BYTES}B`,
      );
    }

    const dur = Date.now() - t0;
    await logFetch({ path, status: "miss_fetch", durationMs: dur });
    return {
      path,
      content: fresh.content,
      sha: fresh.sha,
      sizeBytes: fresh.sizeBytes,
      fetchedAt: new Date().toISOString(),
      status: "miss_fetch",
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message.slice(0, 500) : "fetch_failed";
    const dur = Date.now() - t0;

    if (cached) {
      await logFetch({
        path,
        status: "error_fallback",
        durationMs: dur,
        errorMessage,
      });
      return {
        path,
        content: cached.content,
        sha: cached.sha,
        sizeBytes: cached.size_bytes,
        fetchedAt: cached.fetched_at,
        status: "error_fallback",
        errorMessage,
      };
    }

    await logFetch({
      path,
      status: "error_fallback",
      durationMs: dur,
      errorMessage,
    });
    throw new Error(`No cache and GitHub failed for ${path}: ${errorMessage}`);
  }
}

/**
 * Parse PROJECT_REGISTRY.md to find the active project root. Looks for a
 * `## CURRENT FOCUS` (or `# CURRENT FOCUS`) section and the first line
 * inside it that matches `projects/<vendor>/<repo>` or a backtick-wrapped
 * path. Falls back to FALLBACK_PROJECT_ROOT on any failure.
 */
export function parseProjectRoot(registryMd: string): string {
  try {
    const lines = registryMd.split(/\r?\n/);
    let inFocus = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (/^#+\s*CURRENT\s+FOCUS\b/i.test(line)) {
        inFocus = true;
        continue;
      }
      if (inFocus && /^#+\s/.test(line)) break;
      if (!inFocus) continue;
      const match = line.match(/projects\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
      if (match) return match[0].replace(/\/+$/, "");
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_PROJECT_ROOT;
}

export async function resolveProjectRoot(): Promise<{
  projectRoot: string;
  registryFile: ConstitutionFile;
}> {
  const registryFile = await fetchConstitutionFile("PROJECT_REGISTRY.md");
  const projectRoot = parseProjectRoot(registryFile.content);
  return { projectRoot, registryFile };
}

type Tier2Rule = { name: string; path: string; regex: RegExp };

function tier2Rules(projectRoot: string): Tier2Rule[] {
  return [
    {
      name: "ROADMAP",
      path: `${projectRoot}/state/ROADMAP.md`,
      regex: /\b(roadmap|phase|milestone|quarter|q[1-4])\b/i,
    },
    {
      name: "WORKTODO",
      path: `${projectRoot}/state/WORKTODO.md`,
      regex: /\b(task|todo|backlog|worktodo|issue|ticket)\b/i,
    },
    {
      name: "CHANGELOG",
      path: `${projectRoot}/state/CHANGELOG.md`,
      regex: /\b(changelog|release|shipped|history|version)\b/i,
    },
    {
      name: "KNOWLEDGE_BASE",
      // Cross-project: the knowledge base lives at the repo root, not under
      // any single project. Triggered by architecture/infra/api/convention
      // questions per the Phase 3a spec.
      path: `docs/KNOWLEDGE_BASE.md`,
      regex:
        /\b(architecture|knowledge|design|spec|infra|infrastructure|api|convention|conventions|how does|why does)\b/i,
    },
  ];
}

export function selectTier2(
  userMessage: string,
  projectRoot: string,
): Tier2Match[] {
  const matches: Tier2Match[] = [];
  for (const rule of tier2Rules(projectRoot)) {
    if (rule.regex.test(userMessage)) {
      matches.push({ path: rule.path, reason: rule.name });
    }
  }
  return matches;
}

export const OPERATOR_ENCODING_BLOCK = `OPERATOR NAME ENCODING — STRICT:
When you reference yourself or other operators in chat output, use these exact strings character-for-character:

- WARP\u{1F539}CMD        ← Director (you). Diamond is U+1F539 (small blue diamond emoji).
- WARP\u{2022}FORGE      ← Builder. Bullet is U+2022.
- WARP\u{2022}SENTINEL   ← Validator. Bullet is U+2022.
- WARP\u{2022}ECHO       ← Reporter. Bullet is U+2022.

NEVER substitute the diamond with: \u{25C6} (U+25C6), \u{25C7} (U+25C7), \u{2666} (U+2666), \u{1F538} (U+1F538), \u{2022} (bullet), or any other character.
NEVER substitute the bullet (\u{2022}, U+2022) with any other character.
NEVER add spaces around the diamond or bullet — operator names are single tokens (e.g. "WARP\u{1F539}CMD", not "WARP \u{1F539} CMD" and not "WARP \u{25C6} CMD").

When you describe agent status (e.g., online, ready, standby), write it as:
  WARP\u{1F539}CMD online   — no spaces, no quotes around the name.`;

export type BuildPromptResult = {
  prompt: string;
  warnings: string[];
  files: ConstitutionFile[];
  /**
   * Tier-1 files only (registry + AGENTS + COMMANDER + PROJECT_STATE).
   * Used by the chat route to track per-session SHA drift.
   */
  tier1Files: ConstitutionFile[];
  projectRoot: string;
  tier2Loaded: Tier2Match[];
  source: "live" | "safe_default";
};

/**
 * Synthesize a placeholder ConstitutionFile for a path that could not be
 * fetched and has no cached version. Lets the prompt assembler render a
 * well-formed (but degraded) section instead of collapsing to safe-default.
 */
function placeholderFor(path: string, errorMessage: string): ConstitutionFile {
  return {
    path,
    content: `<!-- ${path} unavailable: ${errorMessage} -->`,
    sha: "",
    sizeBytes: 0,
    fetchedAt: new Date().toISOString(),
    status: "error_fallback",
    errorMessage,
  };
}

/**
 * Build the WARP🔹CMD system prompt for a chat turn.
 *
 * Tier 1 loads unconditionally. Tier 2 loads only when keywords match.
 * Section structure: PERSONA · GLOBAL RULES · ACTIVE PROJECTS ·
 * CURRENT OPERATIONAL TRUTH · ADDITIONAL CONTEXT.
 *
 * Per-file resilience: if a Tier 1 file fails AND has no cache, we
 * synthesize a placeholder for that one path and emit a warning rather
 * than collapsing the whole assembly. The caller only drops to
 * safe-default when the registry itself can't be resolved.
 */
export async function buildSystemPrompt(
  userMessage: string,
): Promise<BuildPromptResult> {
  const warnings: string[] = [];

  // PROJECT_REGISTRY.md — required first to resolve project root. If
  // this single file is unrecoverable we still throw so the chat route
  // drops to safe-default (we can't even pick a project without it).
  const registryFile = await fetchConstitutionFile("PROJECT_REGISTRY.md");
  const projectRoot = parseProjectRoot(registryFile.content);
  if (registryFile.status === "error_fallback") {
    warnings.push(
      `Constitution stale: PROJECT_REGISTRY.md served from cache (${registryFile.errorMessage ?? "github error"}).`,
    );
  }

  // Other Tier 1 files in parallel. Each rejection is caught and
  // replaced with a placeholder + warning so a single missing file
  // cannot tank the whole prompt.
  const otherTier1: string[] = TIER1_PATHS_GLOBAL.filter(
    (p) => p !== "PROJECT_REGISTRY.md",
  );
  const stateMdPath = `${projectRoot}/state/PROJECT_STATE.md`;
  const tier1Targets = [...otherTier1, stateMdPath];
  const tier1Settled = await Promise.allSettled(
    tier1Targets.map((p) => fetchConstitutionFile(p)),
  );
  const tier1Results: ConstitutionFile[] = tier1Settled.map((r, i) => {
    const targetPath = tier1Targets[i];
    if (r.status === "fulfilled") return r.value;
    const errMsg =
      r.reason instanceof Error
        ? r.reason.message
        : typeof r.reason === "string"
          ? r.reason
          : "unavailable";
    warnings.push(
      `Constitution unavailable: ${targetPath} — ${errMsg} (using placeholder).`,
    );
    return placeholderFor(targetPath, errMsg);
  });

  const byPath = new Map<string, ConstitutionFile>();
  for (const f of tier1Results) {
    byPath.set(f.path, f);
    if (f.status === "error_fallback" && f.sha !== "") {
      // Only emit the "stale-from-cache" warning for true cache fallbacks
      // (sha non-empty). Placeholder synthesis above already emitted its
      // own "unavailable" warning.
      warnings.push(
        `Constitution stale: ${f.path} served from cache (${f.errorMessage ?? "github error"}).`,
      );
    }
  }
  byPath.set(registryFile.path, registryFile);

  // Tier 2 — keyword-routed. Misses are non-fatal.
  const tier2Matches = selectTier2(userMessage, projectRoot);
  const tier2Files: ConstitutionFile[] = [];
  if (tier2Matches.length > 0) {
    const t2Results = await Promise.allSettled(
      tier2Matches.map((m) => fetchConstitutionFile(m.path)),
    );
    t2Results.forEach((r, i) => {
      const m = tier2Matches[i];
      if (r.status === "fulfilled") {
        tier2Files.push(r.value);
        if (r.value.status === "error_fallback") {
          warnings.push(
            `Tier-2 ${m.reason} stale (${r.value.errorMessage ?? "github error"}).`,
          );
        }
      }
    });
  }

  // Assemble.
  const sections: string[] = [];
  sections.push(OPERATOR_ENCODING_BLOCK);
  sections.push(
    `— Encoding rules above are non-negotiable. Persona content below this block is authoritative for behavior. —`,
  );
  sections.push(
    `## PERSONA\n` +
      renderFileBlock(byPath.get("AGENTS.md")) +
      "\n\n" +
      renderFileBlock(byPath.get("COMMANDER.md")),
  );
  sections.push(
    `## GLOBAL RULES\n(See AGENTS.md "Brand Rules" / "Anti-patterns" / "Directive Block Format" sections above. They are mandatory and apply to every response.)`,
  );
  sections.push(
    `## ACTIVE PROJECTS\n` + renderFileBlock(registryFile),
  );
  sections.push(
    `## CURRENT OPERATIONAL TRUTH\n` +
      `Active project root: \`${projectRoot}\`\n\n` +
      renderFileBlock(byPath.get(stateMdPath)),
  );
  if (tier2Files.length > 0) {
    sections.push(
      `## ADDITIONAL CONTEXT (loaded for this turn)\n` +
        tier2Files.map((f) => renderFileBlock(f)).join("\n\n"),
    );
  }

  const tier1All = [registryFile, ...tier1Results];
  const allFiles = [...tier1All, ...tier2Files];
  return {
    prompt: sections.join("\n\n"),
    warnings,
    files: allFiles,
    tier1Files: tier1All,
    projectRoot,
    tier2Loaded: tier2Matches.filter((m) =>
      tier2Files.some((f) => f.path === m.path),
    ),
    source: "live",
  };
}

function renderFileBlock(file: ConstitutionFile | undefined): string {
  if (!file) return "";
  return `### ${file.path}\n${file.content.trim()}`;
}

const CMD = `WARP\u{1F539}CMD`;
const FORGE = `WARP\u{2022}FORGE`;
const SENTINEL = `WARP\u{2022}SENTINEL`;
const ECHO = `WARP\u{2022}ECHO`;

/**
 * Hardcoded safe-default prompt used only when the live constitution is
 * unreachable AND no cache exists. Preserves the operator-encoding block
 * from Task #6 so diamond/bullet behavior survives in degraded mode.
 */
export const SAFE_DEFAULT_SYSTEM_PROMPT = `${OPERATOR_ENCODING_BLOCK}

— SAFE-DEFAULT MODE — running on hardcoded fallback. Constitution unreachable. —

You are ${CMD} — the Commander agent of WalkerMind OS, reporting to Mr. Walker (BayueWalker, founder).

## Role
Receive directives. Decide:
1. Whether the task is dispatch-ready or needs one clarifying question first
2. Which operator agent owns execution
3. The exact directive block to emit

## Operator Roster
- ${FORGE} — builder. Code, branches, file edits, PRs.
- ${SENTINEL} — validator. Audits MAJOR FORGE work.
- ${ECHO} — reporter. HTML reports, state updates.

## Brand Rules (strict)
- Branch format: \`WARP/{feature-slug}\` — lowercase, hyphen-separated only.
- Repo: github.com/${CONSTITUTION_REPO.owner}/${CONSTITUTION_REPO.name}

## Directive Block Format
\`\`\`directive
TARGET: ${FORGE}
TASK: <one-line build/edit/review/report action>
BRANCH: WARP/<feature-slug>
SCOPE: <files or surfaces touched>
ACCEPTANCE: <observable success criterion>
PRIORITY: low | medium | high
\`\`\`

Tone: sharp technical lead. No filler. Mirror Mr. Walker's input language (Bahasa Indonesia by default, English when he writes English). Inside directive blocks, all content is English.

NOTE TO SELF: I am running on the safe-default prompt because the live constitution at ${CONSTITUTION_REPO.owner}/${CONSTITUTION_REPO.name} is unreachable AND no cached version exists. Project context is unavailable. Acknowledge this briefly to Mr. Walker if relevant.`;

// ─────────────────────── Per-session SHA drift ───────────────────────
//
// Stored in `public.session_constitution_state` (session_id, path → sha).
// On each chat turn we (1) read the previously-seen SHAs for this session,
// (2) diff them against the SHAs of the Tier-1 files just loaded, (3)
// inject a heads-up block into the system prompt when anything changed,
// and (4) upsert the current SHAs so the *next* turn starts from this
// new baseline.

export type ConstitutionDiffEntry = {
  path: string;
  previousSha: string;
  currentSha: string;
};

export type ConstitutionDiff = {
  changed: ConstitutionDiffEntry[];
  /** True when no prior SHAs were recorded for this session. */
  isFirstTurn: boolean;
};

/**
 * Read the previously-seen Tier-1 SHAs for a session. Returns an empty
 * map on either "first turn ever" or any DB error — drift detection is
 * best-effort and must never block a chat reply.
 */
export async function readSessionConstitutionShas(
  sessionId: string,
): Promise<Map<string, string>> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("session_constitution_state")
    .select("path, sha")
    .eq("session_id", sessionId);
  const map = new Map<string, string>();
  if (error || !data) return map;
  for (const row of data as { path: string; sha: string }[]) {
    if (row.path && row.sha) map.set(row.path, row.sha);
  }
  return map;
}

/**
 * Upsert the current Tier-1 SHAs for a session. Skips placeholder files
 * (sha === "") so a transient unavailability doesn't poison the baseline.
 */
export async function writeSessionConstitutionShas(
  sessionId: string,
  files: ConstitutionFile[],
): Promise<void> {
  const supabase = getServerSupabase();
  const rows = files
    .filter((f) => f.sha && f.sha.length > 0)
    .map((f) => ({
      session_id: sessionId,
      path: f.path,
      sha: f.sha,
      seen_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("session_constitution_state")
    .upsert(rows, { onConflict: "session_id,path" });
  if (error) {
    console.error(
      `[constitution] failed to persist session SHAs (${rows.length} rows): ${error.message}`,
    );
  }
}

/**
 * Compare current Tier-1 file SHAs to what the session saw last turn.
 * New paths that had no prior SHA are NOT reported as "changed" — they
 * could just be the first time this session loaded the file (e.g., the
 * project root was different on the prior turn).
 */
export function diffConstitutionShas(
  previousShas: Map<string, string>,
  currentFiles: ConstitutionFile[],
): ConstitutionDiff {
  const changed: ConstitutionDiffEntry[] = [];
  for (const f of currentFiles) {
    if (!f.sha) continue; // skip placeholders
    const prev = previousShas.get(f.path);
    if (prev !== undefined && prev !== f.sha) {
      changed.push({ path: f.path, previousSha: prev, currentSha: f.sha });
    }
  }
  return { changed, isFirstTurn: previousShas.size === 0 };
}

/**
 * Render the heads-up block that gets appended to the system prompt
 * when one or more Tier-1 files changed mid-session. Empty string when
 * there are no changes.
 */
export function renderConstitutionDiffBlock(diff: ConstitutionDiff): string {
  if (diff.changed.length === 0) return "";
  const lines = diff.changed.map(
    (c) =>
      `- ${c.path} (${c.previousSha.slice(0, 7)} → ${c.currentSha.slice(0, 7)})`,
  );
  return [
    `## CONSTITUTION UPDATED MID-SESSION`,
    `The following authoritative files have changed since your last reply in this session. The sections above already reflect the new content.`,
    `Briefly acknowledge to Mr. Walker that the operational truth shifted before answering, so earlier replies in this conversation aren't taken as still-current.`,
    ``,
    ...lines,
  ].join("\n");
}
