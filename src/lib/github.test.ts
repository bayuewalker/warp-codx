/**
 * Task #31 — Direct unit tests for the `fetchRepoFile` Octokit adapter.
 *
 * The constitution test suite (Task #11) mocks out this entire module, so
 * any drift between `fetchRepoFile` and the real Octokit response shape
 * would slip past those tests and only show up live in the chat route.
 *
 * Strategy:
 *   - Mock `@octokit/rest` at the *client* level (not the whole `./github`
 *     module). The mock constructor records the auth token it was given
 *     and exposes a `getContent` spy whose behavior each test programs.
 *   - The real `getClient()` caches the Octokit instance in a module-level
 *     `_client` variable, so we `vi.resetModules()` in `beforeEach` and
 *     dynamically re-import `./github` per test. That also means each test
 *     can independently set or unset `GITHUB_PAT_CONSTITUTION`.
 *   - No real network calls. No real PAT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getContentMock = vi.fn();
const octokitConstructorCalls: Array<{ auth?: string }> = [];

vi.mock("@octokit/rest", () => {
  class OctokitMock {
    rest: { repos: { getContent: typeof getContentMock; get: typeof getContentMock } };
    constructor(opts: { auth?: string } = {}) {
      octokitConstructorCalls.push({ auth: opts.auth });
      this.rest = {
        repos: {
          getContent: getContentMock,
          // pingRepo() uses repos.get; reuse the same spy for parity.
          get: getContentMock,
        },
      };
    }
  }
  return { Octokit: OctokitMock };
});

const ORIGINAL_PAT = process.env.GITHUB_PAT_CONSTITUTION;

beforeEach(() => {
  vi.resetModules();
  getContentMock.mockReset();
  octokitConstructorCalls.length = 0;
  process.env.GITHUB_PAT_CONSTITUTION = "ghp_test_token_value";
});

afterEach(() => {
  if (ORIGINAL_PAT === undefined) {
    delete process.env.GITHUB_PAT_CONSTITUTION;
  } else {
    process.env.GITHUB_PAT_CONSTITUTION = ORIGINAL_PAT;
  }
});

function makeFileResponse(opts: {
  content: string;
  sha?: string;
  type?: "file" | "dir" | "symlink" | "submodule";
  omitContent?: boolean;
}) {
  const base64 = Buffer.from(opts.content, "utf8").toString("base64");
  const data: Record<string, unknown> = {
    type: opts.type ?? "file",
    sha: opts.sha ?? "sha-default",
    name: "AGENTS.md",
    path: "AGENTS.md",
    size: Buffer.byteLength(opts.content, "utf8"),
    encoding: "base64",
  };
  if (!opts.omitContent) {
    data.content = base64;
  }
  return { data, status: 200, url: "", headers: {} };
}

function makeOctokitError(status: number, message: string) {
  const err = new Error(message) as Error & {
    status?: number;
    response?: { headers: Record<string, string> };
  };
  err.name = "HttpError";
  err.status = status;
  // Simulate the headers object Octokit attaches to errors — these are
  // what we explicitly do NOT want re-thrown to callers.
  err.response = { headers: { "x-ratelimit-remaining": "0" } };
  return err;
}

describe("fetchRepoFile — success path", () => {
  it("decodes base64, returns content + sha + sizeBytes", async () => {
    const text = "# AGENTS\n\nHello, walker.\n";
    getContentMock.mockResolvedValueOnce(makeFileResponse({ content: text, sha: "sha-success" }));

    const { fetchRepoFile } = await import("./github");
    const file = await fetchRepoFile("AGENTS.md");

    expect(file.content).toBe(text);
    expect(file.sha).toBe("sha-success");
    expect(file.sizeBytes).toBe(Buffer.byteLength(text, "utf8"));
  });

  it("calls Octokit with the canonical owner/repo and the requested path", async () => {
    getContentMock.mockResolvedValueOnce(makeFileResponse({ content: "x", sha: "s" }));

    const { fetchRepoFile } = await import("./github");
    await fetchRepoFile("PROJECT_REGISTRY.md");

    expect(getContentMock).toHaveBeenCalledTimes(1);
    const arg = getContentMock.mock.calls[0][0];
    expect(arg.owner).toBe("bayuewalker");
    expect(arg.repo).toBe("walkermind-os");
    expect(arg.path).toBe("PROJECT_REGISTRY.md");
    // An AbortSignal is forwarded for the per-call 10s timeout guard.
    expect(arg.request?.signal).toBeDefined();
  });

  it("forwards the PAT into the Octokit constructor", async () => {
    getContentMock.mockResolvedValueOnce(makeFileResponse({ content: "x", sha: "s" }));

    const { fetchRepoFile } = await import("./github");
    await fetchRepoFile("AGENTS.md");

    expect(octokitConstructorCalls).toHaveLength(1);
    expect(octokitConstructorCalls[0].auth).toBe("ghp_test_token_value");
  });

  it("decodes multi-byte UTF-8 correctly through base64", async () => {
    // The walker constitution actually contains CJK in places — make sure
    // we're decoding via Buffer (not naive atob) so byte counts stay right.
    const text = "北月 walker — 行者\n";
    getContentMock.mockResolvedValueOnce(makeFileResponse({ content: text, sha: "sha-utf8" }));

    const { fetchRepoFile } = await import("./github");
    const file = await fetchRepoFile("AGENTS.md");

    expect(file.content).toBe(text);
    expect(file.sizeBytes).toBe(Buffer.byteLength(text, "utf8"));
  });
});

describe("fetchRepoFile — error normalization", () => {
  it("normalizes a 401 into a `github_401: ...` error string", async () => {
    getContentMock.mockRejectedValueOnce(makeOctokitError(401, "Bad credentials"));

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("AGENTS.md")).rejects.toThrow(/^github_401:/);
  });

  it("normalizes a 404 into a `github_404: ...` error string", async () => {
    getContentMock.mockRejectedValueOnce(makeOctokitError(404, "Not Found"));

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("does-not-exist.md")).rejects.toThrow(/^github_404:/);
  });

  it("normalizes a 500 into a `github_500: ...` error string", async () => {
    getContentMock.mockRejectedValueOnce(makeOctokitError(500, "Internal server error"));

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("AGENTS.md")).rejects.toThrow(/^github_500:/);
  });

  it("never re-throws the raw Octokit error (no response headers leak)", async () => {
    const raw = makeOctokitError(401, "Bad credentials");
    getContentMock.mockRejectedValueOnce(raw);

    const { fetchRepoFile } = await import("./github");
    let caught: unknown;
    try {
      await fetchRepoFile("AGENTS.md");
    } catch (e) {
      caught = e;
    }
    // The caught error is a *new* Error, not the raw Octokit error that
    // carries `.response.headers`. That's what keeps the PAT out of logs.
    expect(caught).not.toBe(raw);
    expect((caught as { response?: unknown }).response).toBeUndefined();
    // And the message itself must not contain the PAT value.
    expect((caught as Error).message).not.toContain("ghp_test_token_value");
  });

  it("falls back to a generic message when the error has no status code", async () => {
    // Network-level failures (ECONNRESET, etc) come through without a
    // `.status` — the adapter should still produce a thrown Error and not
    // propagate the raw object.
    const networkErr = new Error("ECONNRESET");
    getContentMock.mockRejectedValueOnce(networkErr);

    const { fetchRepoFile } = await import("./github");
    let caught: unknown;
    try {
      await fetchRepoFile("AGENTS.md");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(/^github_\d+/);
    expect((caught as Error).message).toContain("ECONNRESET");
  });
});

describe("fetchRepoFile — environment + response-shape guards", () => {
  it("throws a descriptive error when GITHUB_PAT_CONSTITUTION is missing", async () => {
    delete process.env.GITHUB_PAT_CONSTITUTION;

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("AGENTS.md")).rejects.toThrow(
      /Missing required environment variable: GITHUB_PAT_CONSTITUTION/,
    );
    // And we must not have constructed an Octokit (or made a network call).
    expect(octokitConstructorCalls).toHaveLength(0);
    expect(getContentMock).not.toHaveBeenCalled();
  });

  it("rejects when GitHub returns a directory listing (array) instead of a file", async () => {
    // getContent returns an array for directory paths — that's the API
    // contract the adapter has to defend against.
    getContentMock.mockResolvedValueOnce({ data: [{ type: "file", name: "x" }], status: 200, url: "", headers: {} });

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("docs/")).rejects.toThrow(/is not a file/);
  });

  it("rejects when the response type is not 'file' (e.g. submodule)", async () => {
    getContentMock.mockResolvedValueOnce(makeFileResponse({ content: "x", type: "submodule" }));

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("vendored/sub")).rejects.toThrow(/is not a file/);
  });

  it("rejects when the response is a file but has no inline content field", async () => {
    // For very large files GitHub omits inline `content` and expects a
    // separate blob fetch — the adapter doesn't support that and should
    // surface a clear error rather than crash on `undefined`.
    getContentMock.mockResolvedValueOnce(makeFileResponse({ content: "x", omitContent: true }));

    const { fetchRepoFile } = await import("./github");
    await expect(fetchRepoFile("HUGE.md")).rejects.toThrow(/has no inline content/);
  });
});
