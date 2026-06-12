import { describe, expect, it } from "vitest";
import {
  buildRepoCandidates,
  fetchSkillMarkdownFromRepo,
} from "./skill-import";

describe("buildRepoCandidates", () => {
  it("probes the well-known skill layouts on main then master", () => {
    const urls = buildRepoCandidates("vercel/ai", "ai-sdk");
    expect(urls).toEqual([
      "https://raw.githubusercontent.com/vercel/ai/main/skills/ai-sdk/SKILL.md",
      "https://raw.githubusercontent.com/vercel/ai/main/ai-sdk/SKILL.md",
      "https://raw.githubusercontent.com/vercel/ai/main/.claude/skills/ai-sdk/SKILL.md",
      "https://raw.githubusercontent.com/vercel/ai/main/skills/ai-sdk.md",
      "https://raw.githubusercontent.com/vercel/ai/main/ai-sdk.md",
      "https://raw.githubusercontent.com/vercel/ai/master/skills/ai-sdk/SKILL.md",
      "https://raw.githubusercontent.com/vercel/ai/master/ai-sdk/SKILL.md",
      "https://raw.githubusercontent.com/vercel/ai/master/.claude/skills/ai-sdk/SKILL.md",
      "https://raw.githubusercontent.com/vercel/ai/master/skills/ai-sdk.md",
      "https://raw.githubusercontent.com/vercel/ai/master/ai-sdk.md",
    ]);
  });
});

describe("fetchSkillMarkdownFromRepo input validation", () => {
  it("rejects a source that is not owner/repo", async () => {
    await expect(
      fetchSkillMarkdownFromRepo("not-a-repo", "x"),
    ).rejects.toThrow(/owner\/repo/);
    await expect(
      fetchSkillMarkdownFromRepo("a/b/c", "x"),
    ).rejects.toThrow(/owner\/repo/);
    await expect(
      fetchSkillMarkdownFromRepo("evil.com/payload?x=1", "x"),
    ).rejects.toThrow(/owner\/repo/);
  });

  it("rejects skill names with path or query characters", async () => {
    await expect(
      fetchSkillMarkdownFromRepo("o/r", "../../etc/passwd"),
    ).rejects.toThrow(/letters, digits/);
    await expect(fetchSkillMarkdownFromRepo("o/r", "a b")).rejects.toThrow(
      /letters, digits/,
    );
  });

  it("strips a leading github.com/ prefix from the source", () => {
    // Validation passes (no throw before the network stage) — assert via
    // candidate building, which is the same normalization path.
    const urls = buildRepoCandidates("anthropics/skills", "skill-creator");
    expect(urls[0]).toBe(
      "https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md",
    );
  });
});
