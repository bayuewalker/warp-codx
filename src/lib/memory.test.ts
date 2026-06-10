/**
 * Tests for the pure memory helpers: candidate parsing (model output) and
 * system-prompt rendering. CRUD + extraction network paths degrade to safe
 * defaults and are not exercised here.
 */
import { describe, expect, it } from "vitest";
import { parseCandidates, renderMemorySection, type Memory } from "./memory";

function mem(over: Partial<Memory>): Memory {
  return {
    id: "1",
    content: "c",
    source: "manual",
    status: "active",
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("parseCandidates", () => {
  it("parses a plain JSON array", () => {
    expect(parseCandidates('["likes TS", "uses Next.js"]')).toEqual([
      "likes TS",
      "uses Next.js",
    ]);
  });

  it("strips ```json fences", () => {
    expect(parseCandidates('```json\n["a", "b"]\n```')).toEqual(["a", "b"]);
  });

  it("extracts the first [...] block from surrounding prose", () => {
    expect(parseCandidates('Sure! ["only this"] hope that helps')).toEqual([
      "only this",
    ]);
  });

  it("drops non-strings and empties, caps at 5", () => {
    expect(parseCandidates('["a", 1, "", "b", "c", "d", "e", "f"]')).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("returns [] for empty / non-array / garbage", () => {
    expect(parseCandidates("")).toEqual([]);
    expect(parseCandidates("[]")).toEqual([]);
    expect(parseCandidates("not json")).toEqual([]);
    expect(parseCandidates('{"a":1}')).toEqual([]);
  });
});

describe("renderMemorySection", () => {
  it("returns '' when there are no active memories", () => {
    expect(renderMemorySection([])).toBe("");
    expect(renderMemorySection([mem({ status: "pending" })])).toBe("");
  });

  it("renders only active entries as a bullet list under ## MEMORY", () => {
    const out = renderMemorySection([
      mem({ id: "1", content: "Prefers TypeScript", status: "active" }),
      mem({ id: "2", content: "ignored", status: "pending" }),
      mem({ id: "3", content: "Uses Next.js", status: "active" }),
    ]);
    expect(out).toContain("## MEMORY");
    expect(out).toContain("- Prefers TypeScript");
    expect(out).toContain("- Uses Next.js");
    expect(out).not.toContain("ignored");
  });
});
