/**
 * Phase 4 — Direct route tests for `POST /api/push/subscribe`.
 *
 * Covers:
 *   - validation of subscription shape (endpoint, keys.p256dh, keys.auth required)
 *   - invalid JSON → 400
 *   - happy path → 200 + supabase upsert called with correct row
 *   - supabase upsert error → 500 (sanitized)
 *   - supabase throw → 500
 *   - subscribe is intentionally NOT admin-gated (anyone can opt-in)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseUpsertMock = vi.fn();
const supabaseFromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

beforeEach(() => {
  supabaseUpsertMock.mockReset();
  supabaseFromMock.mockReset();
  getServerSupabaseMock.mockReset();

  supabaseUpsertMock.mockResolvedValue({ error: null });
  supabaseFromMock.mockReturnValue({ upsert: supabaseUpsertMock });
  getServerSupabaseMock.mockReturnValue({ from: supabaseFromMock });
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(body: unknown, opts?: { rawBody?: string }): Request {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    body: opts?.rawBody ?? JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
  });
}

describe("POST /api/push/subscribe — validation", () => {
  it("returns 400 on invalid JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(undefined, { rawBody: "{not-json" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_json");
    expect(supabaseUpsertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when subscription is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when endpoint is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ subscription: { keys: { p256dh: "p", auth: "a" } } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when keys.p256dh is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        subscription: {
          endpoint: "https://fcm.googleapis.com/x",
          keys: { auth: "a" },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when keys.auth is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        subscription: {
          endpoint: "https://fcm.googleapis.com/x",
          keys: { p256dh: "p" },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty endpoint string", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        subscription: { endpoint: "", keys: { p256dh: "p", auth: "a" } },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/push/subscribe — success path", () => {
  it("returns 200 + upserts row with endpoint as conflict key", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        subscription: {
          endpoint: "https://fcm.googleapis.com/abc",
          keys: { p256dh: "PUBLIC", auth: "AUTH" },
        },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ subscribed: true });

    expect(supabaseFromMock).toHaveBeenCalledWith("push_subscriptions");
    expect(supabaseUpsertMock).toHaveBeenCalledTimes(1);

    const [row, opts] = supabaseUpsertMock.mock.calls[0];
    expect(row.endpoint).toBe("https://fcm.googleapis.com/abc");
    expect(row.p256dh).toBe("PUBLIC");
    expect(row.auth).toBe("AUTH");
    expect(row.user_agent).toBe("vitest");
    expect(typeof row.last_used_at).toBe("string");
    expect(opts).toEqual({ onConflict: "endpoint" });
  });
});

describe("POST /api/push/subscribe — failure paths", () => {
  it("returns 500 when supabase upsert returns an error", async () => {
    supabaseUpsertMock.mockResolvedValueOnce({
      error: { message: "constraint violated" },
    });
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        subscription: {
          endpoint: "https://fcm.googleapis.com/abc",
          keys: { p256dh: "p", auth: "a" },
        },
      }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("failed to persist subscription");
  });

  it("returns 500 when supabase throws", async () => {
    getServerSupabaseMock.mockImplementationOnce(() => {
      throw new Error("supabase env missing");
    });
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        subscription: {
          endpoint: "https://fcm.googleapis.com/abc",
          keys: { p256dh: "p", auth: "a" },
        },
      }),
    );
    expect(res.status).toBe(500);
  });
});
