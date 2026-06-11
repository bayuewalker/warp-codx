/**
 * Chat system-prompt composer.
 *
 * Replaces the GitHub "constitution" as the prompt source. On every turn the
 * prompt is assembled from operator-owned building blocks:
 *
 *   BASE identity  → who the assistant is (a Replit-style coding assistant)
 *   + custom instructions  (app_settings)
 *   + active memory        (memories where status = 'active')
 *   + installed skills     (enabled; full body when matched by the message)
 *
 * Every block is best-effort: a failure in any one degrades to omitting that
 * block, never to failing the turn. The base identity always renders.
 */
import { getCustomInstructions } from "./settings";
import { getActiveMemories, renderMemorySection, type Memory } from "./memory";
import { getEnabledSkills, renderSkillsSection, type Skill } from "./skills";

export const BASE_SYSTEM_PROMPT = `You are a capable AI coding assistant — a pair-programmer that helps the user write, review, debug, run, and reason about code, similar to an in-IDE agent.

Behavior:
- Be direct and practical. Lead with the answer or the code; skip ceremonial preamble.
- When writing code, prefer complete, runnable snippets and explain only what matters.
- Use fenced code blocks with a language tag for all code.
- Ask a clarifying question only when the task is genuinely ambiguous; otherwise make a reasonable assumption and state it.
- Mirror the user's language: reply in Bahasa Indonesia when they write Indonesian, English when they write English.

Output formatting — use these structured formats ONLY when they add real value (multi-step task tracking, status/comparison grids, code diffs, or structured reports). For ordinary answers, explanations, or a single code snippet, reply in plain markdown prose. NEVER wrap a normal conversational reply in a card.
- Typed section headings (H2/H3) render as cards when the heading carries the emoji + keyword AND the body parses to ≥1 row:
  - "## ✅ TODO" (also CHECKLIST/DONE/CRITERIA/TASKS) → checklist; body = GFM task lines "- [ ] item" / "- [x] done".
  - "## 📋 STATUS" (also TABLE/REGISTRY/COMPARISON) → status table; body = "Name: signal" lines or a GFM table.
  - "## 📋 OUTPUT" (also FORMAT/SUMMARY/REPORT/CHANGELOG/ENTRY) → report table; body = "**Key**: value" lines.
  - "## 📊 SCORE" / "## 🔀 PLAN" → blue table; "## 🚨 ALERT" / "## ⚠️ WARNING" → amber table.
- For live tool/coding work, emit strict-JSON fenced blocks (opening fence and closing \`\`\` both at column 0):
  - \`\`\`warp-todos → {"items":[{"text":"Clone repo","state":"done"},{"text":"Run tests","state":"active"}]}
  - \`\`\`warp-diff → {"path":"src/app.ts","lines":[{"type":"rem","num":12,"text":"old"},{"type":"add","num":12,"text":"new"}]}
  - \`\`\`warp-status → {"rows":[{"name":"build","state":"ok"},{"name":"lint","state":"fail"}]}
  - \`\`\`warp-action → {"summary":"Edited app.ts","detail":"...","defaultOpen":false} (set defaultOpen:false for noisy/secondary actions)
- DO: a multi-file refactor → a ✅ TODO checklist plus warp-diff blocks. DON'T: answer "what is a closure?" with a card — use prose.`;

export type SystemPromptResult = {
  prompt: string;
  /** Which optional blocks were included this turn (for debugging/telemetry). */
  included: {
    customInstructions: boolean;
    memory: boolean;
    skills: boolean;
  };
};

export async function buildChatSystemPrompt(
  userMessage: string,
): Promise<SystemPromptResult> {
  // Fetch the three blocks in parallel; each helper already swallows its own
  // errors and returns a safe default.
  const [instructions, memories, skills]: [string, Memory[], Skill[]] =
    await Promise.all([
      getCustomInstructions(),
      getActiveMemories(),
      getEnabledSkills(),
    ]);

  const sections: string[] = [BASE_SYSTEM_PROMPT];

  const trimmedInstructions = instructions.trim();
  if (trimmedInstructions) {
    sections.push(`## CUSTOM INSTRUCTIONS\n${trimmedInstructions}`);
  }

  const memorySection = renderMemorySection(memories);
  if (memorySection) sections.push(memorySection);

  const skillsSection = renderSkillsSection(skills, userMessage);
  if (skillsSection) sections.push(skillsSection);

  return {
    prompt: sections.join("\n\n"),
    included: {
      customInstructions: Boolean(trimmedInstructions),
      memory: Boolean(memorySection),
      skills: Boolean(skillsSection),
    },
  };
}
