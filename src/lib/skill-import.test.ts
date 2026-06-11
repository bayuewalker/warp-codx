/**
 * Tests for the GitHub-link → raw-URL normalization used by skill import.
 * The fetch path itself is integration-tested separately; here we lock the
 * pure URL rewriting + host allowlist.
 */
import { describe, expect, it } from "vitest";
import { toRawGitHubUrl } from "./skill-import";

describe("toRawGitHubUrl", () => {
  it("rewrites a github.com blob URL to raw.githubusercontent.com", () => {
    expect(
      toRawGitHubUrl(
        "https://github.com/acme/skills/blob/main/skills/python/SKILL.md",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/skills/python/SKILL.md",
    );
  });

  it("passes a raw.githubusercontent.com URL through unchanged", () => {
    const raw =
      "https://raw.githubusercontent.com/acme/skills/main/SKILL.md";
    expect(toRawGitHubUrl(raw)).toBe(raw);
  });

  it("appends /raw to a gist page URL", () => {
    expect(toRawGitHubUrl("https://gist.github.com/user/abc123")).toBe(
      "https://gist.github.com/user/abc123/raw",
    );
  });

  it("rejects non-GitHub hosts", () => {
    expect(() => toRawGitHubUrl("https://evil.example.com/skill.md")).toThrow(
      /only github/i,
    );
  });

  it("rejects a github.com URL without a specific file", () => {
    expect(() => toRawGitHubUrl("https://github.com/acme/skills")).toThrow(
      /file|raw/i,
    );
  });

  it("rejects garbage input", () => {
    expect(() => toRawGitHubUrl("not a url")).toThrow(/valid url/i);
  });
});
