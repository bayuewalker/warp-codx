/**
 * Task #42 — direct route tests for `POST /api/chat` covering the
 * stream-truncation fix:
 *
 *   - the request to the OpenAI/OpenRouter client always includes
 *     `max_tokens: 8192` (so OpenRouter doesn't fall back to its low
 *     ~1024-token default for Anthropic models)
 *   - a normal `finish_reason: "stop"` stream is forwarded verbatim
 *     and persisted as-is
 *   - a truncated stream (`finish_reason: "length"`) appends the
 *     "Response truncated — reply with 'continue'" notice to BOTH
 *     the live byte stream AND the row written to Supabase
 *
 * Supabase, OpenAI, and the constitution loader are mocked end-to-end
 * so the route runs in pure isolation (no network, no env coupling).
 * Mocking style mirrors `src/app/api/sessions/route.test.ts` and
 * `src/app/api/prs/list/route.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TRUNCATION_NOTICE =
  "\n\n⚠️ Response truncated — reply with 'continue' to get the rest.";

const createMock = vi.fn();
const openaiClient = {
  chat: { completions: { create: createMock } },
};

vi.mock("@/lib/openai", () => ({
  getOpenAI: () => openaiClient,
}));

vi.mock("@/lib/constitution", () => ({
  buildSystemPrompt: vi.fn(async () => ({
    prompt: "SYSTEM_PROMPT",
    warnings: [],
    source: "live" as const,
    // Empty so the per-session SHA drift branch is skipped — that
    // path has its own dedicated coverage in constitution.test.ts.
    tier1Files: [],
  })),
  SAFE_DEFAULT_SYSTEM_PROMPT: "SAFE_DEFAULT",
  readSessionConstitutionShas: vi.fn(async () => ({})),
  writeSessionConstitutionShas: vi.fn(async () => {}),
  diffConstitutionShas: vi.fn(() => ({ changed: [], added: [], removed: [] })),
  renderConstitutionDiffBlock: vi.fn(() => ""),
}));

const inserts: Array<{ table: string; row: unknown }> = [];

function makeSupabase() {
  return {
    from(table: string) {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: "sess-1", label: "Existing label" },
                  error: null,
                }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      }
      if (table === "messages") {
        return {
          insert: (row: unknown) => {
            inserts.push({ table, row });
            return Promise.resolve({ data: null, error: null });
          },
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      // chat_warnings, etc. — accept and record any insert.
      return {
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

const supabaseClient = makeSupabase();

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: () => supabaseClient,
}));

/**
 * Build an async-iterable that mimics the OpenAI streaming response
 * shape: a series of delta chunks followed by a terminal chunk that
 * carries the `finish_reason`.
 */
function makeCompletionStream(
  deltas: string[],
  finishReason: "stop" | "length" | "tool_calls" | null,
) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      const total = deltas.length + 1; // +1 for the terminal frame
      return {
        async next() {
          if (i >= total) return { value: undefined, done: true as const };
          if (i < deltas.length) {
            const value = {
              choices: [
                {
                  delta: { content: deltas[i] },
                  finish_reason: null,
                },
              ],
            };
            i += 1;
            return { value, done: false as const };
          }
          // Terminal chunk: empty delta, real finish_reason.
          i += 1;
          return {
            value: {
              choices: [
                {
                  delta: {},
                  finish_reason: finishReason,
                },
              ],
            },
            done: false as const,
          };
        },
      };
    },
  };
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) acc += decoder.decode(value, { stream: true });
  }
  acc += decoder.decode();
  return acc;
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  inserts.length = 0;
  createMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chat — stream truncation handling", () => {
  it("sends max_tokens: 8192 to the OpenAI client (alongside model/stream/temperature/messages)", async () => {
    createMock.mockResolvedValueOnce(
      makeCompletionStream(["hello", " world"], "stop"),
    );
    const { POST } = await import("./route");

    const res = await POST(
      makeReq({ sessionId: "sess-1", content: "hi cmd" }),
    );
    // Drain so the stream's `start()` actually runs to completion
    // (the create() call happens inside start()).
    await readBody(res);

    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0];
    expect(args).toMatchObject({
      stream: true,
      temperature: 0.6,
      max_tokens: 8192,
    });
    expect(typeof args.model).toBe("string");
    expect(Array.isArray(args.messages)).toBe(true);
  });

  it("does NOT append the truncation notice when finish_reason is 'stop' — stream and persisted row match the raw deltas", async () => {
    createMock.mockResolvedValueOnce(
      makeCompletionStream(["alpha ", "beta ", "gamma"], "stop"),
    );
    const { POST } = await import("./route");

    const res = await POST(
      makeReq({ sessionId: "sess-1", content: "hi cmd" }),
    );
    const body = await readBody(res);

    expect(body).toBe("alpha beta gamma");
    expect(body).not.toContain("Response truncated");

    // First insert is the user message; the assistant insert is the
    // one with role: "assistant".
    const assistantInsert = inserts
      .filter((i) => i.table === "messages")
      .map((i) => i.row as { role: string; content: string })
      .find((r) => r.role === "assistant");
    expect(assistantInsert).toBeDefined();
    expect(assistantInsert!.content).toBe("alpha beta gamma");
    expect(assistantInsert!.content).not.toContain("Response truncated");
  });

  it("appends the truncation notice to BOTH the live stream and the persisted assistant row when finish_reason is 'length'", async () => {
    createMock.mockResolvedValueOnce(
      makeCompletionStream(["partial", " reply"], "length"),
    );
    const { POST } = await import("./route");

    const res = await POST(
      makeReq({ sessionId: "sess-1", content: "long task" }),
    );
    const body = await readBody(res);

    expect(body).toBe("partial reply" + TRUNCATION_NOTICE);
    expect(body).toMatch(
      /\n\n⚠️ Response truncated — reply with 'continue' to get the rest\.$/,
    );

    const assistantInsert = inserts
      .filter((i) => i.table === "messages")
      .map((i) => i.row as { role: string; content: string })
      .find((r) => r.role === "assistant");
    expect(assistantInsert).toBeDefined();
    expect(assistantInsert!.content).toBe("partial reply" + TRUNCATION_NOTICE);
  });
});
