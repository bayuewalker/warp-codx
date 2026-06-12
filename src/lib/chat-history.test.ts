/**
 * Tests for the bounded chat-history window: pass-through under budget,
 * newest-first retention over budget, and the always-keep-newest rule.
 */
import { describe, expect, it } from "vitest";
import {
  budgetChatHistory,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
} from "./chat-history";

const msg = (role: string, content: string) => ({ role, content });

describe("budgetChatHistory", () => {
  it("returns an empty window for an empty transcript", () => {
    expect(budgetChatHistory([])).toEqual({ messages: [], dropped: 0 });
  });

  it("passes a small transcript through untouched, in order", () => {
    const rows = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
    const w = budgetChatHistory(rows);
    expect(w.messages).toEqual(rows);
    expect(w.dropped).toBe(0);
  });

  it("drops the OLDEST messages when over the message cap", () => {
    const rows = Array.from({ length: 10 }, (_, i) => msg("user", `m${i}`));
    const w = budgetChatHistory(rows, { maxMessages: 3 });
    expect(w.messages.map((m) => m.content)).toEqual(["m7", "m8", "m9"]);
    expect(w.dropped).toBe(7);
  });

  it("drops the OLDEST messages when over the char budget", () => {
    const rows = [
      msg("user", "x".repeat(50)),
      msg("assistant", "y".repeat(50)),
      msg("user", "z".repeat(50)),
    ];
    // Budget fits exactly the two newest messages.
    const w = budgetChatHistory(rows, { maxChars: 100 });
    expect(w.messages.map((m) => m.content[0])).toEqual(["y", "z"]);
    expect(w.dropped).toBe(1);
  });

  it("always keeps the newest message even when it alone exceeds the budget", () => {
    const rows = [msg("user", "old"), msg("user", "n".repeat(500))];
    const w = budgetChatHistory(rows, { maxChars: 100 });
    expect(w.messages).toHaveLength(1);
    expect(w.messages[0].content).toBe("n".repeat(500));
    expect(w.dropped).toBe(1);
  });

  it("default caps are sane (window bounded in both dimensions)", () => {
    expect(MAX_HISTORY_MESSAGES).toBeGreaterThan(0);
    expect(MAX_HISTORY_CHARS).toBeGreaterThan(10_000);
    const rows = Array.from({ length: MAX_HISTORY_MESSAGES + 50 }, (_, i) =>
      msg(i % 2 ? "assistant" : "user", `message ${i}`),
    );
    const w = budgetChatHistory(rows);
    expect(w.messages.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    // Newest message always survives.
    expect(w.messages[w.messages.length - 1].content).toBe(
      `message ${MAX_HISTORY_MESSAGES + 49}`,
    );
  });
});
