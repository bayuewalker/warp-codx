/**
 * Tests for chat-export helpers: markdown transcript, filename slugging,
 * code-block filename derivation, and language→extension mapping.
 */
import { describe, expect, it } from "vitest";
import {
  formatChatMarkdown,
  exportFilename,
  extForLang,
  codeBlockFilename,
} from "./chat-export";
import type { Message } from "./types";

function msg(role: Message["role"], content: string): Message {
  return { id: role + content, session_id: "s", role, content, created_at: "2026-06-11T00:00:00Z" };
}

describe("formatChatMarkdown", () => {
  it("renders a titled transcript with speaker headings", () => {
    const md = formatChatMarkdown(
      [msg("user", "hi"), msg("assistant", "hello **there**")],
      "My session",
    );
    expect(md).toContain("# My session");
    expect(md).toContain("## You\n\nhi");
    expect(md).toContain("## WARP CodX\n\nhello **there**");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("falls back to a default title", () => {
    expect(formatChatMarkdown([], null)).toContain("# WARP CodX chat");
  });
});

describe("exportFilename", () => {
  it("slugs the title and stamps the date", () => {
    expect(exportFilename("Polymarket Bot!")).toMatch(/^warp-codx-polymarket-bot-\d{4}-\d{2}-\d{2}\.md$/);
  });
  it("handles empty/blank titles", () => {
    expect(exportFilename("")).toMatch(/^warp-codx-chat-\d{4}-\d{2}-\d{2}\.md$/);
    expect(exportFilename(null)).toMatch(/^warp-codx-chat-/);
  });
});

describe("extForLang", () => {
  it("maps known languages and defaults to txt", () => {
    expect(extForLang("typescript")).toBe("ts");
    expect(extForLang("PY")).toBe("py");
    expect(extForLang("yaml")).toBe("yml");
    expect(extForLang(undefined)).toBe("txt");
    expect(extForLang("nonsense")).toBe("txt");
  });
});

describe("codeBlockFilename", () => {
  it("uses a first-line path comment when present", () => {
    expect(codeBlockFilename("ts", "// src/config.ts\nexport const x = 1;")).toBe("config.ts");
    expect(codeBlockFilename("yaml", "# docker-compose.yml\nservices: {}")).toBe("docker-compose.yml");
    expect(codeBlockFilename("html", "<!-- index.html -->\n<h1/>")).toBe("index.html");
    expect(codeBlockFilename("ts", "// file: app.ts\n//...")).toBe("app.ts");
  });
  it("falls back to snippet.<ext> without a name", () => {
    expect(codeBlockFilename("python", "print('hi')")).toBe("snippet.py");
    expect(codeBlockFilename(undefined, "plain text")).toBe("snippet.txt");
  });
});
