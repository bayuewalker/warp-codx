/**
 * Tests for the pure provider-key helpers: secret masking, the browser-safe
 * serializer (must never leak the raw key), and provider validation.
 */
import { describe, expect, it } from "vitest";
import { maskKey, toPublic, isProvider, type ProviderKey } from "./provider-keys";

describe("maskKey", () => {
  it("masks the middle of a long key", () => {
    expect(maskKey("sk-1234567890abcd")).toBe("sk-1…abcd");
  });
  it("fully hides short keys", () => {
    expect(maskKey("short")).toBe("••••");
  });
});

describe("toPublic", () => {
  it("never includes the raw api_key", () => {
    const row: ProviderKey = {
      id: "1",
      provider: "blackbox",
      api_key: "sk-supersecretvalue",
      label: "primary",
      enabled: true,
      priority: 10,
      last_error: null,
      created_at: "t",
      updated_at: "t",
    };
    const pub = toPublic(row);
    expect(JSON.stringify(pub)).not.toContain("supersecret");
    expect(pub.keyPreview).toBe("sk-s…alue");
    expect(pub).toMatchObject({ provider: "blackbox", label: "primary", enabled: true });
    expect("api_key" in pub).toBe(false);
  });
});

describe("isProvider", () => {
  it("accepts the three supported providers only", () => {
    expect(isProvider("openrouter")).toBe(true);
    expect(isProvider("openai")).toBe(true);
    expect(isProvider("blackbox")).toBe(true);
    expect(isProvider("gemini")).toBe(false);
    expect(isProvider(123)).toBe(false);
  });
});
