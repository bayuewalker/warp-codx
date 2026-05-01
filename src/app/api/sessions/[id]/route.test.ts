/**
 * Task #37 — direct route tests for `GET /api/sessions/[id]`.
 *
 * After a chat stream finishes, the client refreshes just the active
 * session's `updated_at` so the sidebar row hops to the top — without
 * re-pulling the whole (now paginated) list. This route is what makes
 * that cheap.
 *
 * Coverage:
 *   - 400 when id is missing
 *   - 404 when supabase returns no row
 *   - 500 (sanitized) when supabase errors
 *   - 200 + `{ session }` on the happy path
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

beforeEach(() => {
  maybeSingleMock.mockReset();
  eqMock.mockReset();
  selectMock.mockReset();
  fromMock.mockReset();
  getServerSupabaseMock.mockReset();

  eqMock.mockReturnValue({ maybeSingle: maybeSingleMock });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
  getServerSupabaseMock.mockReturnValue({ from: fromMock });
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(): Request {
  return new Request("http://localhost/api/sessions/abc");
}

describe("GET /api/sessions/[id]", () => {
  it("returns 400 when id is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: { id: "" } });
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no session matches the id", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: { id: "missing" } });
    expect(res.status).toBe(404);
    expect(eqMock).toHaveBeenCalledWith("id", "missing");
  });

  it("returns 500 with sanitized message on supabase error", async () => {
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "db gone" },
    });
    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: { id: "abc" } });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("db gone");
  });

  it("returns the session on the happy path", async () => {
    const session = {
      id: "abc",
      label: "hi",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    maybeSingleMock.mockResolvedValue({ data: session, error: null });
    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: { id: "abc" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session).toEqual(session);
    expect(selectMock).toHaveBeenCalledWith(
      "id, label, created_at, updated_at",
    );
  });
});
