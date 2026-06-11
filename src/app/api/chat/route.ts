import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/roles";
import { openChatStreamWithFailover } from "@/lib/llm";
import {
  autoPickModelId,
  resolveSelectedModel,
  isSelectableModelId,
  type SelectableModelId,
} from "@/lib/models";
import { buildChatSystemPrompt, BASE_SYSTEM_PROMPT } from "@/lib/system-prompt";
import { extractAndStoreMemories } from "@/lib/memory";
import { ISSUE_DRAFT_PROTOCOL } from "@/lib/issue-draft-protocol";
import { PR_ACTION_PROTOCOL } from "@/lib/pr-action-protocol";
import { TASK_COMPLETE_PROTOCOL } from "@/lib/task-complete-protocol";
import { RICH_BLOCKS_PROTOCOL } from "@/lib/rich-blocks-protocol";
import { NEUTRAL_IDENTITY_PROMPT } from "@/lib/multi-agent-protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatBody = {
  sessionId?: string;
  content?: string;
  /** User-selected model id from the composer picker ("auto" by default). */
  model?: string;
};

/**
 * POST /api/chat
 *
 * Body: { sessionId, content }
 *
 * Inserts the user message, builds the WARP🔹CMD system prompt from the
 * live constitution (Phase 3a), streams the assistant reply, and inserts
 * the final assistant message after streaming completes.
 *
 * Response: text/plain chunked stream.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim();
  const content = body.content?.trim();
  // Resolve the user's model choice. "Auto" routes per message (coding →
  // Sonnet, chat → GPT-4o); an explicit pick pins that model. Either way the
  // failover chain can still fall over to another provider on a credit error.
  const selectedId: SelectableModelId = isSelectableModelId(body.model)
    ? body.model
    : "auto";

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }
  if (!content) {
    return NextResponse.json(
      { error: "content is required" },
      { status: 400 },
    );
  }

  const supabase = getServerSupabase();

  // Verify the session exists AND belongs to the caller (per-user isolation).
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("id, label")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Persist user message first so it shows up via Realtime in other tabs.
  const { error: userInsertErr } = await supabase
    .from("messages")
    .insert({ session_id: sessionId, role: "user", content });

  if (userInsertErr) {
    return NextResponse.json(
      { error: `Failed to persist user message: ${userInsertErr.message}` },
      { status: 500 },
    );
  }

  // Bump the session's freshness; auto-derive a label from the first
  // user message while it still carries the default placeholder.
  const sessionPatch: { updated_at: string; label?: string } = {
    updated_at: new Date().toISOString(),
  };
  if (session.label.startsWith("New directive")) {
    sessionPatch.label = content.replace(/\s+/g, " ").slice(0, 60);
  }
  await supabase.from("sessions").update(sessionPatch).eq("id", sessionId);

  // Load the full conversation history so the model has context.
  const { data: history, error: historyErr } = await supabase
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (historyErr) {
    return NextResponse.json(
      { error: `Failed to load history: ${historyErr.message}` },
      { status: 500 },
    );
  }

  // Build the system prompt from operator-owned blocks (custom instructions,
  // memory, installed skills) — see src/lib/system-prompt.ts. Each block
  // degrades independently, so this only throws on an unexpected error.
  let systemPrompt: string;
  try {
    const built = await buildChatSystemPrompt(content);
    systemPrompt = built.prompt;
  } catch (err) {
    console.error(
      `[chat] system-prompt build failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    systemPrompt = BASE_SYSTEM_PROMPT;
  }

  // Phase 3b — additive issue-draft protocol. Appended to either the
  // live or safe-default system prompt without touching the
  // constitution-fetch layer (per hard constraint).
  systemPrompt = `${systemPrompt}\n${ISSUE_DRAFT_PROTOCOL}`;

  // Phase 3c — additive PR action protocol (list / detail / merge / close).
  // Same additive pattern as ISSUE_DRAFT_PROTOCOL above. The server-side
  // gate in /api/prs/[number]/merge is the actual enforcement; this
  // protocol just teaches CMD to emit the correct marker so the client
  // mounts the right card.
  systemPrompt = `${systemPrompt}\n${PR_ACTION_PROTOCOL}`;

  // Phase 3.5 — additive task-complete protocol. Teaches CMD to emit a
  // single `<!-- TASK_COMPLETE: {json} -->` marker at the end of any
  // turn that confirms a task reached a terminal state (issue created,
  // PR merged/closed/held, constitution refreshed, generic done). The
  // client (`MessageContent.tsx`) parses the marker, strips it from
  // the prose, and renders a `TaskCompleteCard` summarising the
  // outcome. Same additive pattern as the two protocols above; no
  // changes to constitution-fetch or any execution route.
  systemPrompt = `${systemPrompt}\n${TASK_COMPLETE_PROTOCOL}`;

  // Rich blocks — teaches CMD the four `warp-*` fenced JSON blocks
  // (action / diff / todos / status) that the client renders as
  // Ona-style cards. The render pipeline (rich-blocks-extract.ts +
  // components/blocks/*) predates this protocol; without it the model
  // never emitted the fences, so replies rendered as plain markdown.
  systemPrompt = `${systemPrompt}\n${RICH_BLOCKS_PROTOCOL}`;

  // Neutral identity — appended last so it wins over any branding the model
  // might infer from custom instructions or skills.
  systemPrompt = `${systemPrompt}\n${NEUTRAL_IDENTITY_PROMPT}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(history ?? []).map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  // "Auto" resolves per message; an explicit pick is used verbatim. Computed
  // here (where `content` is narrowed to a string) and captured by the stream.
  const effectiveModelId =
    selectedId === "auto" ? autoPickModelId(content) : selectedId;

  const encoder = new TextEncoder();
  let assembled = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Auto-switch across configured providers/keys — if one is out of
        // credit / rate-limited, the next available key is used. See
        // src/lib/llm.ts.
        const { stream: completion } = await openChatStreamWithFailover({
          role: "cmd",
          messages,
          temperature: 0.6,
          maxTokens: 8192,
          resolveModel: (provider) =>
            resolveSelectedModel(effectiveModelId, provider),
        });

        let finishReason: string | null | undefined = null;
        for await (const part of completion) {
          const delta = part.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            assembled += delta;
            controller.enqueue(encoder.encode(delta));
          }
          const fr = part.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
        }

        console.log(
          `[chat] stream ended sessionId=${sessionId} finish_reason=${finishReason ?? "null"} assembled_length=${assembled.length}`,
        );

        // Surface OpenRouter/Anthropic max-token truncation to the user
        // so they know to type "continue" to get the rest of the reply.
        // Persisted to Supabase as part of the assistant message so the
        // saved transcript matches what was streamed.
        if (finishReason === "length") {
          const truncationNotice =
            "\n\n⚠️ Response truncated — reply with 'continue' to get the rest.";
          controller.enqueue(encoder.encode(truncationNotice));
          assembled += truncationNotice;
        }

        // Persist the assistant's final message.
        if (assembled.trim().length > 0) {
          const { error: insertErr } = await supabase
            .from("messages")
            .insert({
              session_id: sessionId,
              role: "assistant",
              content: assembled,
            });
          if (insertErr) {
            controller.enqueue(
              encoder.encode(
                `\n\n[system] Failed to persist assistant message: ${insertErr.message}`,
              ),
            );
          } else {
            await supabase
              .from("sessions")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", sessionId);
          }
        }

        // Auto-memory — extract durable facts from this turn and store them
        // as `pending` for operator review. Best-effort and detached: the
        // reply is already streamed and persisted above, so the stream must
        // not stay open while a second LLM round-trip completes.
        if (assembled.trim().length > 0) {
          void extractAndStoreMemories(content, assembled).catch(() => {
            /* best-effort */
          });
        }

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`\n\n[system] Stream error: ${message}`),
        );
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
