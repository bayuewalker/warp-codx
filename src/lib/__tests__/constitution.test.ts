/**
 * Task #11 — Constitution fetch + fallback unit tests.
 *
 * Mocks `./github` and `./supabase` so the tests never touch the real
 * GitHub PAT or the Supabase project. Each test asserts both the
 * returned `ConstitutionFile` shape AND the side-effect rows that
 * would land in `constitution_fetch_log` (and, where applicable, the
 * `warnings[]` array that `chat_warnings` is downstream of in
 * `src/app/api/chat/route.ts`).
 *
 * Mock surface intentionally narrow — only the methods constitution.ts
 * calls (`from(...).select(...).eq(...).maybeSingle()`,
 * `from(...).upsert(...)`, `from(...).insert(...)`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchLogRow = {
  path: string;
  status: "hit_cache" | "miss_fetch" | "error_fallback";
  duration_ms: number;
  error_message: string | null;
};

type CacheRow = {
  path: string;
  content: string;
  sha: string;
  size_bytes: number;
  fetched_at: string;
};

const fetchLog: FetchLogRow[] = [];
const cacheStore = new Map<string, CacheRow>();
let upsertCalls: CacheRow[] = [];

vi.mock("../github", () => {
  return {
    CONSTITUTION_REPO: { owner: "bayuewalker", name: "walkermind-os" },
    fetchRepoFile: vi.fn(),
  };
});

vi.mock("../supabase", () => {
  // Mimic the chained builder shape constitution.ts uses. Each `.from()`
  // call returns an object that satisfies whichever chain that table is
  // accessed with.
  const supabase = {
    from(table: string) {
      if (table === "constitution_cache") {
        return {
          select() {
            return {
              eq(_col: string, val: string) {
                return {
                  async maybeSingle() {
                    const row = cacheStore.get(val) ?? null;
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
          async upsert(row: CacheRow) {
            upsertCalls.push(row);
            cacheStore.set(row.path, row);
            return { error: null };
          },
        };
      }
      if (table === "constitution_fetch_log") {
        return {
          async insert(row: FetchLogRow) {
            fetchLog.push(row);
            return { error: null };
          },
        };
      }
      // Catch-all so an unexpected table name surfaces clearly in tests.
      throw new Error(`Unexpected supabase table accessed in test: ${table}`);
    },
  };
  return { getServerSupabase: () => supabase };
});

import { fetchRepoFile } from "../github";
import {
  CACHE_TTL_MS,
  FALLBACK_PROJECT_ROOT,
  buildSystemPrompt,
  fetchConstitutionFile,
  parseProjectRoot,
  resolveProjectRoot,
} from "../constitution";

const mockedFetchRepoFile = vi.mocked(fetchRepoFile);

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function seedCache(path: string, opts: { freshOffsetMs?: number; sha?: string; content?: string } = {}): CacheRow {
  const row: CacheRow = {
    path,
    content: opts.content ?? `# cached ${path}`,
    sha: opts.sha ?? "cached-sha-" + path,
    size_bytes: (opts.content ?? `# cached ${path}`).length,
    // Default: fresh (within TTL). Pass a negative offset to make stale.
    fetched_at: nowIso(opts.freshOffsetMs ?? -1000),
  };
  cacheStore.set(path, row);
  return row;
}

beforeEach(() => {
  fetchLog.length = 0;
  cacheStore.clear();
  upsertCalls = [];
  mockedFetchRepoFile.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────── fetchConstitutionFile ────────────────────────

describe("fetchConstitutionFile", () => {
  it("path 1 — cache hit returns cached content and logs hit_cache", async () => {
    const cached = seedCache("AGENTS.md", { content: "fresh-cached", sha: "sha-A" });

    const file = await fetchConstitutionFile("AGENTS.md");

    expect(file.status).toBe("hit_cache");
    expect(file.content).toBe("fresh-cached");
    expect(file.sha).toBe("sha-A");
    expect(file.fetchedAt).toBe(cached.fetched_at);
    expect(mockedFetchRepoFile).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0]).toMatchObject({
      path: "AGENTS.md",
      status: "hit_cache",
      error_message: null,
    });
    expect(fetchLog[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("path 2 — cache miss + GitHub success fetches fresh, upserts cache, logs miss_fetch", async () => {
    mockedFetchRepoFile.mockResolvedValueOnce({
      content: "# fresh from github",
      sha: "sha-fresh",
      sizeBytes: 19,
    });

    const file = await fetchConstitutionFile("AGENTS.md");

    expect(file.status).toBe("miss_fetch");
    expect(file.content).toBe("# fresh from github");
    expect(file.sha).toBe("sha-fresh");
    expect(file.sizeBytes).toBe(19);
    expect(mockedFetchRepoFile).toHaveBeenCalledTimes(1);
    expect(mockedFetchRepoFile).toHaveBeenCalledWith("AGENTS.md");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      path: "AGENTS.md",
      content: "# fresh from github",
      sha: "sha-fresh",
      size_bytes: 19,
    });
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0]).toMatchObject({
      path: "AGENTS.md",
      status: "miss_fetch",
      error_message: null,
    });
  });

  it("path 2b — stale cache + GitHub success bypasses cache and refetches", async () => {
    // Cache row exists but is older than CACHE_TTL_MS → treated as miss.
    seedCache("AGENTS.md", {
      freshOffsetMs: -(CACHE_TTL_MS + 60_000),
      content: "stale-version",
      sha: "sha-stale",
    });
    mockedFetchRepoFile.mockResolvedValueOnce({
      content: "fresh-version",
      sha: "sha-new",
      sizeBytes: 13,
    });

    const file = await fetchConstitutionFile("AGENTS.md");

    expect(file.status).toBe("miss_fetch");
    expect(file.content).toBe("fresh-version");
    expect(mockedFetchRepoFile).toHaveBeenCalledTimes(1);
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].status).toBe("miss_fetch");
  });

  it("path 3 — cache miss + GitHub error + stale cache returns cached, logs error_fallback", async () => {
    seedCache("AGENTS.md", {
      freshOffsetMs: -(CACHE_TTL_MS + 60_000),
      content: "fallback-content",
      sha: "sha-stale",
    });
    mockedFetchRepoFile.mockRejectedValueOnce(
      new Error("github_500: Internal server error"),
    );

    const file = await fetchConstitutionFile("AGENTS.md");

    expect(file.status).toBe("error_fallback");
    expect(file.content).toBe("fallback-content");
    expect(file.sha).toBe("sha-stale");
    expect(file.errorMessage).toBe("github_500: Internal server error");
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0]).toMatchObject({
      path: "AGENTS.md",
      status: "error_fallback",
    });
    expect(fetchLog[0].error_message).toContain("github_500");
  });

  it("path 4 — cache miss + GitHub error + no cache throws and logs error_fallback", async () => {
    mockedFetchRepoFile.mockRejectedValueOnce(
      new Error("github_503: Service unavailable"),
    );

    await expect(fetchConstitutionFile("AGENTS.md")).rejects.toThrow(
      /No cache and GitHub failed for AGENTS\.md/,
    );

    // Even on the throw path the helper logs the failure first.
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0]).toMatchObject({
      path: "AGENTS.md",
      status: "error_fallback",
    });
    expect(fetchLog[0].error_message).toContain("github_503");
  });

  it("path 4b — { forceRefresh: true } bypasses a fresh cache", async () => {
    // Fresh cache (well within TTL) — without forceRefresh this would
    // be served as a hit_cache. Asserts the bypass behavior advertised
    // by `FetchOptions.forceRefresh`.
    seedCache("AGENTS.md", { content: "stale-but-fresh-by-ttl", sha: "sha-old" });
    mockedFetchRepoFile.mockResolvedValueOnce({
      content: "definitely-fresh",
      sha: "sha-new",
      sizeBytes: 16,
    });

    const file = await fetchConstitutionFile("AGENTS.md", { forceRefresh: true });

    expect(file.status).toBe("miss_fetch");
    expect(file.content).toBe("definitely-fresh");
    expect(file.sha).toBe("sha-new");
    expect(mockedFetchRepoFile).toHaveBeenCalledTimes(1);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].sha).toBe("sha-new");
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].status).toBe("miss_fetch");
  });

  it("path 5 — GitHub 401 PAT error follows the error_fallback path", async () => {
    seedCache("AGENTS.md", {
      freshOffsetMs: -(CACHE_TTL_MS + 60_000),
      content: "stale-but-usable",
      sha: "sha-stale",
    });
    mockedFetchRepoFile.mockRejectedValueOnce(
      new Error("github_401: HttpError: Bad credentials"),
    );

    const file = await fetchConstitutionFile("AGENTS.md");

    expect(file.status).toBe("error_fallback");
    expect(file.content).toBe("stale-but-usable");
    expect(file.errorMessage).toMatch(/github_401/);
    expect(file.errorMessage).not.toMatch(/ghp_/); // never leak the PAT
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].status).toBe("error_fallback");
    expect(fetchLog[0].error_message).toContain("github_401");
  });
});

// ──────────────────────── parseProjectRoot / resolveProjectRoot ────────────────────────

describe("parseProjectRoot", () => {
  it("extracts the project path from a well-formed CURRENT FOCUS section", () => {
    const md = [
      "# Active",
      "",
      "## CURRENT FOCUS",
      "",
      "Working in `projects/polymarket/polyquantbot/`",
      "",
      "## Backlog",
      "stuff",
    ].join("\n");
    expect(parseProjectRoot(md)).toBe("projects/polymarket/polyquantbot");
  });

  it("path 6 — malformed CURRENT FOCUS falls back to the safe default", () => {
    // No CURRENT FOCUS heading at all.
    expect(parseProjectRoot("# Some other doc\n\nstuff")).toBe(
      FALLBACK_PROJECT_ROOT,
    );
    // Header present but body has no projects/<vendor>/<repo> match.
    const malformed = [
      "## CURRENT FOCUS",
      "We are between projects right now.",
      "",
      "## Roadmap",
    ].join("\n");
    expect(parseProjectRoot(malformed)).toBe(FALLBACK_PROJECT_ROOT);
    // Empty input.
    expect(parseProjectRoot("")).toBe(FALLBACK_PROJECT_ROOT);
  });

  it("ignores matches that appear OUTSIDE the CURRENT FOCUS block", () => {
    const md = [
      "## Archive",
      "Old work in projects/legacy/oldrepo",
      "",
      "## CURRENT FOCUS",
      "(no path declared here)",
      "",
      "## Notes",
    ].join("\n");
    expect(parseProjectRoot(md)).toBe(FALLBACK_PROJECT_ROOT);
  });

  it("resolveProjectRoot threads parseProjectRoot through fetchConstitutionFile", async () => {
    mockedFetchRepoFile.mockResolvedValueOnce({
      content:
        "## CURRENT FOCUS\n\nFocus is `projects/polymarket/polyquantbot/`\n",
      sha: "sha-reg",
      sizeBytes: 64,
    });

    const { projectRoot, registryFile } = await resolveProjectRoot();

    expect(projectRoot).toBe("projects/polymarket/polyquantbot");
    expect(registryFile.status).toBe("miss_fetch");
    expect(registryFile.path).toBe("PROJECT_REGISTRY.md");
  });
});

// ──────────────────────── buildSystemPrompt → warnings (chat_warnings input) ────────────────────────

describe("buildSystemPrompt — warnings drive chat_warnings", () => {
  /**
   * The `warnings[]` array returned from buildSystemPrompt is the exact
   * payload the chat route maps 1:1 into chat_warnings rows
   * (`src/app/api/chat/route.ts` ~line 183: `warnings.map(message => ({
   * session_id, level, message }))`). So asserting on `warnings[]` here
   * is asserting on what would land in chat_warnings.
   */
  it("error_fallback on a Tier-1 file appears as a 'Constitution stale' warning", async () => {
    // Registry succeeds — buildSystemPrompt only reaches the other Tier-1
    // files once it has a project root.
    mockedFetchRepoFile.mockImplementation(async (path: string) => {
      if (path === "PROJECT_REGISTRY.md") {
        return {
          content:
            "## CURRENT FOCUS\nFocus: `projects/polymarket/polyquantbot/`\n",
          sha: "sha-reg",
          sizeBytes: 64,
        };
      }
      if (path === "AGENTS.md") {
        // Stale cache exists → error_fallback, NOT a placeholder.
        throw new Error("github_500: Internal server error");
      }
      // Other Tier-1 files succeed with trivial content so we don't
      // pollute the warnings array under test.
      return { content: `# ok ${path}`, sha: `sha-${path}`, sizeBytes: 8 };
    });
    seedCache("AGENTS.md", {
      freshOffsetMs: -(CACHE_TTL_MS + 60_000),
      content: "stale-agents",
      sha: "sha-stale",
    });

    const result = await buildSystemPrompt("hello");

    expect(result.source).toBe("live");
    expect(result.projectRoot).toBe("projects/polymarket/polyquantbot");
    const staleWarn = result.warnings.find((w) =>
      /AGENTS\.md served from cache/.test(w),
    );
    expect(staleWarn).toBeDefined();
    expect(staleWarn).toMatch(/Constitution stale/);
    expect(staleWarn).toMatch(/github_500/);
  });

  it("Tier-1 file with no cache + GitHub error becomes a placeholder + 'Constitution unavailable' warning", async () => {
    // Registry succeeds (otherwise buildSystemPrompt throws before we
    // ever hit the placeholder branch). AGENTS.md has NO cache row,
    // so its fetch promise rejects → Promise.allSettled rescues it,
    // emits a placeholder, and pushes the "Constitution unavailable"
    // warning rather than the "stale" one.
    mockedFetchRepoFile.mockImplementation(async (path: string) => {
      if (path === "PROJECT_REGISTRY.md") {
        return {
          content:
            "## CURRENT FOCUS\nFocus: `projects/polymarket/polyquantbot/`\n",
          sha: "sha-reg",
          sizeBytes: 64,
        };
      }
      if (path === "AGENTS.md") {
        throw new Error("github_404: Not Found");
      }
      return { content: `# ok ${path}`, sha: `sha-${path}`, sizeBytes: 8 };
    });
    // No seedCache for AGENTS.md → triggers the "no cache + throws" path.

    const result = await buildSystemPrompt("hello");

    expect(result.source).toBe("live");
    const placeholderWarn = result.warnings.find((w) =>
      /Constitution unavailable: AGENTS\.md/.test(w),
    );
    expect(placeholderWarn).toBeDefined();
    expect(placeholderWarn).toMatch(/using placeholder/);
    expect(placeholderWarn).toMatch(/github_404/);
    // And critically NOT also a stale warning for the same file —
    // placeholder synthesis suppresses the stale path per
    // constitution.ts ~line 381 comment.
    const staleWarn = result.warnings.find((w) =>
      /AGENTS\.md served from cache/.test(w),
    );
    expect(staleWarn).toBeUndefined();
  });
});
