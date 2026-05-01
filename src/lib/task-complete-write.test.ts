/**
 * Phase 3.5 (option a) — unit tests for `writeTaskCompleteMessage`.
 *
 * Coverage matrix:
 *   - Silent no-op on missing sessionId (null / undefined / "").
 *   - Successful insert calls supabase.from("messages").insert with
 *     role='assistant' and content containing the marker.
 *   - Each of the six payload kinds renders prose + marker.
 *   - Supabase insert returning {error} is logged, not thrown.
 *   - Supabase client construction throwing is caught.
 *   - `-->` inside string values is escaped so the extractor cannot
 *     terminate early on user-supplied content.
 *   - The escaped marker round-trips back through
 *     `extractTaskComplete` to the original payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractTaskComplete } from "@/lib/task-complete-extract";

const supabaseInsertMock = vi.fn();
const supabaseFromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

beforeEach(() => {
  supabaseInsertMock.mockReset();
  supabaseFromMock.mockReset();
  getServerSupabaseMock.mockReset();

  supabaseInsertMock.mockResolvedValue({ error: null });
  supabaseFromMock.mockReturnValue({ insert: supabaseInsertMock });
  getServerSupabaseMock.mockReturnValue({ from: supabaseFromMock });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeTaskCompleteMessage — guards", () => {
  it("is a no-op when sessionId is null", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage(null, {
      kind: "generic",
      summary: "x",
    });
    expect(getServerSupabaseMock).not.toHaveBeenCalled();
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("is a no-op when sessionId is undefined", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage(undefined, {
      kind: "generic",
      summary: "x",
    });
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("is a no-op when sessionId is empty string", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("", { kind: "generic", summary: "x" });
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });
});

describe("writeTaskCompleteMessage — successful inserts", () => {
  it("inserts an assistant row with the issue_created marker", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "issue_created",
      issue: {
        number: 127,
        title: "Add foo",
        url: "https://github.com/o/r/issues/127",
      },
    });

    expect(supabaseFromMock).toHaveBeenCalledWith("messages");
    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    const arg = supabaseInsertMock.mock.calls[0][0] as {
      session_id: string;
      role: string;
      content: string;
    };
    expect(arg.session_id).toBe("sess-1");
    expect(arg.role).toBe("assistant");
    expect(arg.content).toContain("Issue #127 created");
    expect(arg.content).toContain("**Add foo**");
    expect(arg.content).toContain(
      `<!-- TASK_COMPLETE: {"kind":"issue_created"`,
    );
    expect(arg.content.trim().endsWith("-->")).toBe(true);
  });

  it("renders pr_merged prose with branch + post-merge reminder", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "pr_merged",
      pr: {
        number: 843,
        branch: "WARP/foo",
        mergeCommit: "abcdef0123456789",
      },
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;
    expect(content).toMatch(/PR #843 merged \(WARP\/foo\)\./);
    expect(content).toMatch(/Post-merge sync required\./);
  });

  it("renders pr_closed prose with optional reason", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "pr_closed",
      pr: { number: 12, reason: "superseded by #15" },
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;
    expect(content).toMatch(/PR #12 closed — superseded by #15\./);
  });

  it("renders pr_closed prose without reason", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "pr_closed",
      pr: { number: 12 },
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;
    expect(content).toMatch(/^PR #12 closed\./);
  });

  it("renders pr_held prose with reason", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "pr_held",
      pr: { number: 88, reason: "awaiting SENTINEL" },
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;
    expect(content).toMatch(/PR #88 held — awaiting SENTINEL\./);
  });

  it("renders constitution_refreshed prose with file count", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "constitution_refreshed",
      refresh: { filesUpdated: 3, lastSyncIso: "2026-05-01T11:00:00Z" },
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;
    expect(content).toMatch(/Constitution refreshed — 3 files updated\./);
  });

  it("renders generic prose verbatim", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "generic",
      summary: "Did the thing.",
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;
    expect(content).toMatch(/^Did the thing\./);
  });
});

describe("writeTaskCompleteMessage — failure isolation", () => {
  it("logs but does not throw when supabase insert returns an error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    supabaseInsertMock.mockResolvedValueOnce({
      error: { message: "fk violation" },
    });

    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await expect(
      writeTaskCompleteMessage("sess-1", { kind: "generic", summary: "x" }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("fk violation"),
    );
    consoleSpy.mockRestore();
  });

  it("logs but does not throw when getServerSupabase throws", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getServerSupabaseMock.mockImplementationOnce(() => {
      throw new Error("env missing");
    });

    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await expect(
      writeTaskCompleteMessage("sess-1", { kind: "generic", summary: "x" }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("env missing"),
    );
    consoleSpy.mockRestore();
  });
});

describe("writeTaskCompleteMessage — marker hardening", () => {
  it("escapes literal `-->` inside string payload values", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    await writeTaskCompleteMessage("sess-1", {
      kind: "generic",
      summary: "before --> after",
    });
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;

    // The literal `-->` inside the JSON value MUST NOT appear — if it
    // did, the extractor's non-greedy regex would terminate the marker
    // early. Only the closing comment delimiter may end with `-->`.
    const innerJson = content
      .split("<!-- TASK_COMPLETE:")[1]
      .replace(/\s*-->\s*$/, "");
    expect(innerJson).not.toContain("-->");
  });

  it("round-trips the escaped marker back through extractTaskComplete", async () => {
    const { writeTaskCompleteMessage } = await import("./task-complete-write");
    const payload = {
      kind: "pr_closed" as const,
      pr: { number: 7, reason: "superseded --> by #9" },
    };
    await writeTaskCompleteMessage("sess-1", payload);
    const content = (
      supabaseInsertMock.mock.calls[0][0] as { content: string }
    ).content;

    const extracted = extractTaskComplete(content);
    expect(extracted.payload).toEqual(payload);
  });
});
