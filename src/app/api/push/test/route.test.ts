/**
 * Phase 4 — Direct route tests for `POST /api/push/test`.
 *
 * Covers:
 *   - admin gate enforcement (403 when isAdminAllowed returns false)
 *   - happy path → 200 + sendPushToAll called with the canned payload
 *   - sendPushToAll never throwing (it's already wrapped) → 200 always
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAdminAllowedMock = vi.fn();
const sendPushToAllMock = vi.fn();

vi.mock("@/lib/adminGate", () => ({
  isAdminAllowed: isAdminAllowedMock,
}));

vi.mock("@/lib/push-server", () => ({
  sendPushToAll: sendPushToAllMock,
}));

beforeEach(() => {
  isAdminAllowedMock.mockReset();
  sendPushToAllMock.mockReset();
  isAdminAllowedMock.mockReturnValue(true);
  sendPushToAllMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(): Request {
  return new Request("http://localhost/api/push/test", { method: "POST" });
}

describe("POST /api/push/test", () => {
  it("returns 403 when admin gate denies", async () => {
    isAdminAllowedMock.mockReturnValue(false);
    const { POST } = await import("./route");
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("forbidden");
    expect(sendPushToAllMock).not.toHaveBeenCalled();
  });

  it("returns 200 and fires the canned test payload", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: true });

    expect(sendPushToAllMock).toHaveBeenCalledTimes(1);
    const payload = sendPushToAllMock.mock.calls[0][0];
    expect(payload.title).toContain("Test");
    expect(typeof payload.body).toBe("string");
    expect(payload.tag).toBe("test");
  });
});
