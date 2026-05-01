/**
 * Task #37 — direct route tests for `GET /api/sessions` pagination.
 *
 * The sidebar now asks the server for one batch of sessions at a time
 * (default 10) instead of receiving the entire history up front. These
 * tests pin the contract:
 *   - default `limit` is 10, capped at 50
 *   - results are ordered `(created_at DESC, id DESC)` so page
 *     boundaries are stable when timestamps tie
 *   - `before` + `beforeId` produce a tuple keyset filter
 *   - `before` alone falls back to a strict `<` filter (legacy)
 *   - `hasMore` is true exactly when an extra row was returned
 *   - `nextCursor` / `nextCursorId` are the `created_at` / `id` of
 *     the last visible row
 *   - supabase errors → 500 (sanitized)
 *
 * Supabase is mocked end-to-end so the test runs in pure isolation
 * (no network, no env coupling).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ltMock = vi.fn();
const orMock = vi.fn();
const limitMock = vi.fn();
const orderMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

/**
 * The query builder is a chain:
 *   from().select().order().order().limit()[.lt() | .or()]
 *
 * Both `lt` / `or` (cursor cases) and `limit` (no-cursor case) are the
 * terminal awaitables, so each must resolve to `{ data, error }`. We
 * make `limit` return a chain node that is *both* thenable and exposes
 * `.lt()` / `.or()` so the route can append a cursor filter or not.
 */
function setupChain(result: { data: unknown; error: unknown }) {
  ltMock.mockReset();
  orMock.mockReset();
  limitMock.mockReset();
  orderMock.mockReset();
  selectMock.mockReset();
  fromMock.mockReset();
  getServerSupabaseMock.mockReset();

  ltMock.mockResolvedValue(result);
  orMock.mockResolvedValue(result);

  limitMock.mockImplementation(() => {
    return {
      lt: ltMock,
      or: orMock,
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled),
    };
  });

  // Two `.order(...)` calls in the route — first returns something
  // chained to `.order(...)` again, the second returns `.limit(...)`.
  orderMock
    .mockReturnValueOnce({ order: orderMock })
    .mockReturnValueOnce({ limit: limitMock });
  // Reset the call-order pattern after each setup so consecutive setups
  // in one test still work.
  orderMock.mockImplementation((() => {
    let call = 0;
    return () => {
      call += 1;
      return call % 2 === 1
        ? { order: orderMock }
        : { limit: limitMock };
    };
  })());

  selectMock.mockReturnValue({ order: orderMock });
  fromMock.mockReturnValue({ select: selectMock });
  getServerSupabaseMock.mockReturnValue({ from: fromMock });
}

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(qs = ""): Request {
  return new Request(`http://localhost/api/sessions${qs}`);
}

function makeSession(i: number) {
  // created_at descends with i so the ORDER BY contract is faithful.
  const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 60 - i)).toISOString();
  return {
    id: `s-${i}`,
    label: `Session ${i}`,
    created_at: ts,
    updated_at: ts,
  };
}

describe("GET /api/sessions — pagination", () => {
  it("defaults to limit=10 and asks supabase for limit+1 rows ordered by (created_at, id) DESC", async () => {
    setupChain({ data: [], error: null });
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    expect(fromMock).toHaveBeenCalledWith("sessions");
    expect(selectMock).toHaveBeenCalledWith(
      "id, label, created_at, updated_at",
    );
    // Two ORDER BYs: created_at then id — the tie-breaker.
    expect(orderMock).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: false,
    });
    expect(orderMock).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    // limit + 1 = 11 (so the route can detect overflow without a count)
    expect(limitMock).toHaveBeenCalledWith(11);
    // No cursor → neither `lt` nor `or` runs.
    expect(ltMock).not.toHaveBeenCalled();
    expect(orMock).not.toHaveBeenCalled();
  });

  it("returns hasMore=false and null cursors when fewer than limit+1 rows come back", async () => {
    const rows = [makeSession(0), makeSession(1), makeSession(2)];
    setupChain({ data: rows, error: null });
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.sessions).toHaveLength(3);
    expect(json.hasMore).toBe(false);
    expect(json.nextCursor).toBeNull();
    expect(json.nextCursorId).toBeNull();
  });

  it("returns hasMore=true, trims the extra row, and sets cursor pair to the last visible row", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => makeSession(i));
    setupChain({ data: rows, error: null });
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    const json = await res.json();
    expect(json.sessions).toHaveLength(10);
    expect(json.hasMore).toBe(true);
    expect(json.nextCursor).toBe(rows[9].created_at);
    expect(json.nextCursorId).toBe(rows[9].id);
    expect(json.sessions.map((s: { id: string }) => s.id)).not.toContain(
      rows[10].id,
    );
  });

  it("forwards the (`before`, `beforeId`) tuple cursor as a PostgREST .or(...) keyset", async () => {
    setupChain({ data: [], error: null });
    const cursor = "2026-01-01T00:00:30.000Z";
    const cursorId = "s-9";
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(
        `?before=${encodeURIComponent(cursor)}` +
          `&beforeId=${encodeURIComponent(cursorId)}&limit=5`,
      ),
    );
    expect(res.status).toBe(200);
    expect(limitMock).toHaveBeenCalledWith(6); // limit + 1
    expect(orMock).toHaveBeenCalledWith(
      `created_at.lt.${cursor},and(created_at.eq.${cursor},id.lt.${cursorId})`,
    );
    expect(ltMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy `lt` form when only `before` is supplied (no `beforeId`)", async () => {
    setupChain({ data: [], error: null });
    const cursor = "2026-01-01T00:00:30.000Z";
    const { GET } = await import("./route");
    const res = await GET(makeReq(`?before=${encodeURIComponent(cursor)}`));
    expect(res.status).toBe(200);
    expect(ltMock).toHaveBeenCalledWith("created_at", cursor);
    expect(orMock).not.toHaveBeenCalled();
  });

  it("clamps a too-large `limit` to 50 (asks supabase for 51)", async () => {
    setupChain({ data: [], error: null });
    const { GET } = await import("./route");
    await GET(makeReq("?limit=999"));
    expect(limitMock).toHaveBeenCalledWith(51);
  });

  it("falls back to default 10 when `limit` is non-numeric or non-positive", async () => {
    setupChain({ data: [], error: null });
    const { GET } = await import("./route");
    await GET(makeReq("?limit=banana"));
    expect(limitMock).toHaveBeenCalledWith(11);

    setupChain({ data: [], error: null });
    const { GET: GET2 } = await import("./route");
    await GET2(makeReq("?limit=0"));
    expect(limitMock).toHaveBeenCalledWith(11);
  });

  it("returns 500 with the supabase error message when the query fails", async () => {
    setupChain({ data: null, error: { message: "boom" } });
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("boom");
  });
});
