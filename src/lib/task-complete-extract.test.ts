/**
 * Unit tests for `extractTaskComplete`. Same shape + style as the
 * `extractPRAction` coverage in `pr-gates.test.ts`: pure-function,
 * permissive-strip / strict-parse policy.
 */
import { describe, expect, it } from "vitest";
import { extractTaskComplete } from "./task-complete-extract";

describe("extractTaskComplete", () => {
  it("returns no payload + untouched content when no marker present", () => {
    const raw = "Hello world\n\nSome prose.";
    expect(extractTaskComplete(raw)).toEqual({
      cleaned: raw,
      payload: null,
    });
  });

  it("parses a well-formed issue_created marker and strips it", () => {
    const raw = `Created the issue.\n\n<!-- TASK_COMPLETE: {"kind":"issue_created","issue":{"number":127,"title":"Foo bar","url":"https://github.com/x/y/issues/127"}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.cleaned).toBe("Created the issue.");
    expect(out.payload).toEqual({
      kind: "issue_created",
      issue: {
        number: 127,
        title: "Foo bar",
        url: "https://github.com/x/y/issues/127",
      },
    });
  });

  it("parses pr_merged with optional fields", () => {
    const raw = `Merged.\n<!-- TASK_COMPLETE: {"kind":"pr_merged","pr":{"number":843,"branch":"WARP/foo","mergeCommit":"abc1234"}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toEqual({
      kind: "pr_merged",
      pr: { number: 843, branch: "WARP/foo", mergeCommit: "abc1234" },
    });
  });

  it("parses pr_closed with reason", () => {
    const raw = `Closed.\n<!-- TASK_COMPLETE: {"kind":"pr_closed","pr":{"number":17,"reason":"superseded"}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toEqual({
      kind: "pr_closed",
      pr: { number: 17, reason: "superseded" },
    });
  });

  it("parses pr_held with reason", () => {
    const raw = `Held.\n<!-- TASK_COMPLETE: {"kind":"pr_held","pr":{"number":24,"reason":"awaiting SENTINEL"}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toEqual({
      kind: "pr_held",
      pr: { number: 24, reason: "awaiting SENTINEL" },
    });
  });

  it("parses constitution_refreshed", () => {
    const raw = `Refreshed.\n<!-- TASK_COMPLETE: {"kind":"constitution_refreshed","refresh":{"filesUpdated":3,"lastSyncIso":"2026-05-01T11:00:00Z"}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toEqual({
      kind: "constitution_refreshed",
      refresh: { filesUpdated: 3, lastSyncIso: "2026-05-01T11:00:00Z" },
    });
  });

  it("parses generic with summary", () => {
    const raw = `Done.\n<!-- TASK_COMPLETE: {"kind":"generic","summary":"All steps complete"} -->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toEqual({
      kind: "generic",
      summary: "All steps complete",
    });
  });

  it("strips a malformed marker (bad JSON) without rendering a card", () => {
    const raw = `Whoops.\n<!-- TASK_COMPLETE: not even json -->`;
    const out = extractTaskComplete(raw);
    expect(out.cleaned).toBe("Whoops.");
    expect(out.payload).toBeNull();
  });

  it("strips a marker with unknown kind without rendering a card", () => {
    const raw = `Whoops.\n<!-- TASK_COMPLETE: {"kind":"explode","summary":"x"} -->`;
    const out = extractTaskComplete(raw);
    expect(out.cleaned).toBe("Whoops.");
    expect(out.payload).toBeNull();
  });

  it("strips a marker missing required nested fields", () => {
    const raw = `Whoops.\n<!-- TASK_COMPLETE: {"kind":"issue_created","issue":{"number":1}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.cleaned).toBe("Whoops.");
    expect(out.payload).toBeNull();
  });

  it("rejects non-positive PR/issue numbers", () => {
    const raw = `<!-- TASK_COMPLETE: {"kind":"pr_merged","pr":{"number":0}} -->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toBeNull();
  });

  it("rejects empty generic summary", () => {
    const raw = `<!-- TASK_COMPLETE: {"kind":"generic","summary":""} -->`;
    expect(extractTaskComplete(raw).payload).toBeNull();
  });

  it("strips multiple markers, keeping only the first valid one", () => {
    const raw = `prose\n<!-- TASK_COMPLETE: {"kind":"generic","summary":"first"} -->\nmore\n<!-- TASK_COMPLETE: {"kind":"generic","summary":"second"} -->`;
    const out = extractTaskComplete(raw);
    expect(out.cleaned).toBe("prose\n\nmore");
    expect(out.payload).toEqual({ kind: "generic", summary: "first" });
  });

  it("tolerates whitespace and newlines inside the marker", () => {
    const raw = `<!--   TASK_COMPLETE:\n  {"kind":"generic","summary":"ok"}\n-->`;
    const out = extractTaskComplete(raw);
    expect(out.payload).toEqual({ kind: "generic", summary: "ok" });
  });
});
