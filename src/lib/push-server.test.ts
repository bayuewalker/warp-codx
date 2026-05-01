/**
 * Phase 4 — Unit tests for `src/lib/push-server.ts`.
 *
 * Covers:
 *   - VAPID env missing → silent no-op (never throws)
 *   - empty subscription set → no calls to web-push
 *   - happy path → sendNotification called per sub with the payload JSON
 *   - 410 / 404 endpoints are GCed from the DB; other errors are NOT
 *   - sendNotification throw with no statusCode → logged, NOT GCed
 *   - getVapidPublicKey reads the env var
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

const supabaseSelectMock = vi.fn();
const supabaseDeleteInMock = vi.fn();
const supabaseDeleteMock = vi.fn();
const supabaseFromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();

  sendNotificationMock.mockReset();
  setVapidDetailsMock.mockReset();
  supabaseSelectMock.mockReset();
  supabaseDeleteInMock.mockReset();
  supabaseDeleteMock.mockReset();
  supabaseFromMock.mockReset();
  getServerSupabaseMock.mockReset();

  // Default supabase shape: from() returns either select() or delete().in()
  supabaseDeleteInMock.mockResolvedValue({ error: null });
  supabaseDeleteMock.mockReturnValue({ in: supabaseDeleteInMock });
  supabaseSelectMock.mockResolvedValue({ data: [], error: null });
  supabaseFromMock.mockReturnValue({
    select: supabaseSelectMock,
    delete: supabaseDeleteMock,
  });
  getServerSupabaseMock.mockReturnValue({ from: supabaseFromMock });

  process.env.VAPID_PUBLIC_KEY = "PUB";
  process.env.VAPID_PRIVATE_KEY = "PRIV";
  process.env.VAPID_EMAIL = "ops@example.com";

  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

describe("sendPushToAll", () => {
  it("silently returns when VAPID env is missing — never throws", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const { sendPushToAll } = await import("./push-server");
    await expect(
      sendPushToAll({ title: "x", body: "y" }),
    ).resolves.toBeUndefined();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("VAPID init failed"),
    );
  });

  it("returns silently when there are no subscriptions", async () => {
    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      "mailto:ops@example.com",
      "PUB",
      "PRIV",
    );
  });

  it("normalizes plain email to mailto: subject", async () => {
    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });
    expect(setVapidDetailsMock.mock.calls[0][0]).toBe("mailto:ops@example.com");
  });

  it("preserves an already-mailto: subject", async () => {
    process.env.VAPID_EMAIL = "mailto:already@example.com";
    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });
    expect(setVapidDetailsMock.mock.calls[0][0]).toBe(
      "mailto:already@example.com",
    );
  });

  it("returns silently when supabase select errors", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("supabase select failed"),
    );
  });

  it("sends one notification per subscription with payload JSON", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: [
        { endpoint: "https://e1", p256dh: "p1", auth: "a1" },
        { endpoint: "https://e2", p256dh: "p2", auth: "a2" },
      ],
      error: null,
    });
    sendNotificationMock.mockResolvedValue({ statusCode: 201 });

    const payload = { title: "Merged", body: "PR #42", tag: "merge:42" };
    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll(payload);

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const [sub1, body1] = sendNotificationMock.mock.calls[0];
    expect(sub1.endpoint).toBe("https://e1");
    expect(sub1.keys).toEqual({ p256dh: "p1", auth: "a1" });
    expect(JSON.parse(body1)).toEqual(payload);
    // No GC when nothing fails.
    expect(supabaseDeleteMock).not.toHaveBeenCalled();
  });

  it("GCs endpoints that return 410 Gone or 404 Not Found", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: [
        { endpoint: "https://gone", p256dh: "p1", auth: "a1" },
        { endpoint: "https://ok", p256dh: "p2", auth: "a2" },
        { endpoint: "https://missing", p256dh: "p3", auth: "a3" },
      ],
      error: null,
    });
    const send =
      sendNotificationMock as MockedFunction<typeof sendNotificationMock>;
    send.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("Gone"), { statusCode: 410 })),
    );
    send.mockImplementationOnce(() => Promise.resolve({ statusCode: 201 }));
    send.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error("Not Found"), { statusCode: 404 })),
    );

    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });

    expect(supabaseDeleteMock).toHaveBeenCalledTimes(1);
    expect(supabaseDeleteInMock).toHaveBeenCalledWith("endpoint", [
      "https://gone",
      "https://missing",
    ]);
  });

  it("does NOT GC on transient errors (5xx, network) — only logs", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: [{ endpoint: "https://e1", p256dh: "p", auth: "a" }],
      error: null,
    });
    sendNotificationMock.mockRejectedValueOnce(
      Object.assign(new Error("server died"), { statusCode: 500 }),
    );

    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });

    expect(supabaseDeleteMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("send failed"),
    );
  });

  it("does NOT GC when the rejection has no statusCode (raw thrown)", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: [{ endpoint: "https://e1", p256dh: "p", auth: "a" }],
      error: null,
    });
    sendNotificationMock.mockRejectedValueOnce(new Error("network blip"));

    const { sendPushToAll } = await import("./push-server");
    await sendPushToAll({ title: "x", body: "y" });

    expect(supabaseDeleteMock).not.toHaveBeenCalled();
  });

  it("contains a SYNCHRONOUS throw from webpush.sendNotification", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: [{ endpoint: "https://e1", p256dh: "p", auth: "a" }],
      error: null,
    });
    sendNotificationMock.mockImplementationOnce(() => {
      // Simulate web-push throwing synchronously (e.g. malformed sub).
      throw new Error("sync explosion");
    });

    const { sendPushToAll } = await import("./push-server");
    await expect(
      sendPushToAll({ title: "x", body: "y" }),
    ).resolves.toBeUndefined();
    // Sync throws are coerced to rejections by the defensive wrapper,
    // so we land in the per-result handler with no statusCode → no GC,
    // and a `[push] send failed` log line.
    expect(supabaseDeleteMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("send failed"),
    );
  });

  it("never throws even when GC delete fails", async () => {
    supabaseSelectMock.mockResolvedValueOnce({
      data: [{ endpoint: "https://e1", p256dh: "p", auth: "a" }],
      error: null,
    });
    sendNotificationMock.mockRejectedValueOnce(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );
    supabaseDeleteInMock.mockResolvedValueOnce({
      error: { message: "delete blocked" },
    });

    const { sendPushToAll } = await import("./push-server");
    await expect(
      sendPushToAll({ title: "x", body: "y" }),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to GC"),
    );
  });
});

describe("getVapidPublicKey", () => {
  it("returns the public key from env", async () => {
    const { getVapidPublicKey } = await import("./push-server");
    expect(getVapidPublicKey()).toBe("PUB");
  });

  it("returns null when env is missing", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const { getVapidPublicKey } = await import("./push-server");
    expect(getVapidPublicKey()).toBeNull();
  });
});
