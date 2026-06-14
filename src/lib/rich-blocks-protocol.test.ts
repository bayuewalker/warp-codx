import { describe, expect, it } from "vitest";
import { RICH_BLOCKS_PROTOCOL } from "./rich-blocks-protocol";
import { extractRichBlocks } from "./rich-blocks-extract";

describe("RICH_BLOCKS_PROTOCOL", () => {
  it("documents all nine fence types", () => {
    for (const lang of [
      "warp-action",
      "warp-diff",
      "warp-todos",
      "warp-status",
      "warp-terminal",
      "warp-command",
      "warp-callout",
      "warp-json",
      "warp-file",
    ]) {
      expect(RICH_BLOCKS_PROTOCOL).toContain(`\`\`\`${lang}`);
    }
  });

  it("its example fences round-trip through extractRichBlocks", () => {
    // The protocol teaches the model by example — if an example ever
    // drifts from what the extractor accepts, the model would emit
    // blocks that get silently dropped. Feed the protocol text itself
    // through the extractor and require one block per fence type.
    const { blocks } = extractRichBlocks(RICH_BLOCKS_PROTOCOL);
    const kinds = blocks.map((b) => b.kind).sort();
    expect(kinds).toEqual([
      "action",
      "callout",
      "command",
      "diff",
      "file",
      "json",
      "status",
      "terminal",
      "todos",
    ]);
  });

  it("example payloads carry the required fields", () => {
    const { blocks } = extractRichBlocks(RICH_BLOCKS_PROTOCOL);
    for (const b of blocks) {
      switch (b.kind) {
        case "action":
          expect(typeof b.payload.summary).toBe("string");
          break;
        case "diff":
          expect(typeof b.payload.path).toBe("string");
          expect(Array.isArray(b.payload.lines)).toBe(true);
          for (const line of b.payload.lines) {
            expect(["add", "rem", "ctx"]).toContain(line.type);
            expect(typeof line.text).toBe("string");
          }
          break;
        case "todos":
          expect(Array.isArray(b.payload.items)).toBe(true);
          for (const item of b.payload.items) {
            expect(typeof item.text).toBe("string");
            expect(["done", "active", "idle"]).toContain(item.state);
          }
          break;
        case "status":
          expect(Array.isArray(b.payload.rows)).toBe(true);
          for (const row of b.payload.rows) {
            expect(typeof row.name).toBe("string");
            expect(["ok", "pending", "fail"]).toContain(row.state);
          }
          break;
      }
    }
  });
});
