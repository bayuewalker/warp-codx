import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getOpenAI, WARP_CMD_SYSTEM_PROMPT } from "@/lib/openai";
import { MODELS } from "@/lib/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatBody = {
  sessionId?: string;
  content?: string;
};

/**
 * POST /api/chat
 *
 * Body: { sessionId, content }
 *
 * Inserts the user message, streams the assistant reply from gpt-4o,
 * and inserts the final assistant message after streaming completes.
 *
 * Response: text/event-stream-style chunked stream of plain text tokens.
 */
export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId?.trim();
  const content = body.content?.trim();

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
  const openai = getOpenAI();

  // Verify session exists
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("id, label")
    .eq("id", sessionId)
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

  // Auto-derive a session label from the first user message if it's still
  // the default placeholder.
  if (session.label.startsWith("New directive")) {
    const newLabel = content.replace(/\s+/g, " ").slice(0, 60);
    await supabase
      .from("sessions")
      .update({ label: newLabel, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } else {
    await supabase
      .from("sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

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

  const messages = [
    { role: "system" as const, content: WARP_CMD_SYSTEM_PROMPT },
    ...(history ?? []).map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  const encoder = new TextEncoder();
  let assembled = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const completion = await openai.chat.completions.create({
          model: MODELS.cmd,
          stream: true,
          temperature: 0.6,
          messages,
        });

        for await (const part of completion) {
          const delta = part.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            assembled += delta;
            controller.enqueue(encoder.encode(delta));
          }
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
                `\n\n[WARP•SENTINEL] Failed to persist assistant message: ${insertErr.message}`,
              ),
            );
          } else {
            await supabase
              .from("sessions")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", sessionId);
          }
        }

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`\n\n[WARP•SENTINEL] Stream error: ${message}`),
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
