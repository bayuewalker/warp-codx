/**
 * Task #35 — Direct route tests for `GET /api/prs/list`.
 *
 * Companion to `src/lib/github-prs.test.ts` (Task #32). The adapter
 * tests cover the Octokit layer; this file covers the layer ABOVE it:
 *   - the production-debug auth gate
 *   - success-path JSON shape (forwards adapter result verbatim)
 *   - sanitized error → HTTP 500 mapping
 *
 * `@/lib/github-prs` and `@/lib/adminGate` are mocked so the route
 * runs in pure isolation — no Octokit, no PAT, no env coupling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listWarpPRsMock = vi.fn();
const isAdminAllowedMock = vi.fn();

vi.mock("@/lib/github-prs", () => ({
  listWarpPRs: listWarpPRsMock,
}));

vi.mock("@/lib/adminGate", () => ({
  isAdminAllowed: isAdminAllowedMock,
}));

beforeEach(() => {
  listWarpPRsMock.mockReset();
  isAdminAllowedMock.mockReset();
  // Default: admin allowed (mirrors dev-permissive behavior). Each
  // auth-gate test overrides this back to false.
  isAdminAllowedMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(): Request {
  return new Request("http://localhost/api/prs/list");
}

describe("GET /api/prs/list — auth gate", () => {
  it("returns 403 forbidden when isAdminAllowed === false", async () => {
    isAdminAllowedMock.mockReturnValueOnce(false);
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    // The adapter must NOT be touched on a denied request.
    expect(listWarpPRsMock).not.toHaveBeenCalled();
  });

  it("forwards the incoming Request to isAdminAllowed", async () => {
    listWarpPRsMock.mockResolvedValueOnce({ prs: [], truncated: false });
    const { GET } = await import("./route");

    const req = makeReq();
    await GET(req);

    expect(isAdminAllowedMock).toHaveBeenCalledTimes(1);
    expect(isAdminAllowedMock).toHaveBeenCalledWith(req);
  });
});

describe("GET /api/prs/list — success path", () => {
  it("returns 200 and the verbatim { prs, truncated } shape from the adapter", async () => {
    const payload = {
      prs: [
        {
          number: 1,
          branch: "WARP/foo",
          author: "bayuewalker",
          tier: "STANDARD",
          state: "open",
        },
      ],
      truncated: false,
    };
    listWarpPRsMock.mockResolvedValueOnce(payload);
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it("propagates truncated=true when the adapter signals more pages", async () => {
    listWarpPRsMock.mockResolvedValueOnce({ prs: [], truncated: true });
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prs: [], truncated: true });
  });
});

describe("GET /api/prs/list — error mapping", () => {
  it("maps `github_list_401` (Bad credentials) to HTTP 401", async () => {
    listWarpPRsMock.mockRejectedValueOnce(
      new Error("github_list_401: HttpError: Bad credentials"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "github_list_401: HttpError: Bad credentials",
    });
  });

  it("maps `github_list_404` to HTTP 404", async () => {
    listWarpPRsMock.mockRejectedValueOnce(
      new Error("github_list_404: HttpError: Not Found"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(404);
  });

  it("maps `github_list_422` (Validation Failed) to HTTP 422", async () => {
    listWarpPRsMock.mockRejectedValueOnce(
      new Error("github_list_422: HttpError: Validation Failed"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(422);
  });

  it("falls through to HTTP 500 for unrecognized status codes", async () => {
    listWarpPRsMock.mockRejectedValueOnce(
      new Error("github_list_500: HttpError: boom"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(500);
  });

  it("maps a non-Error throw to a generic fallback message at 500", async () => {
    listWarpPRsMock.mockRejectedValueOnce("boom-string-not-error");
    const { GET } = await import("./route");

    const res = await GET(makeReq());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "github list failed" });
  });
});
