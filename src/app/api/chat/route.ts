import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { getOpenAI } from "@/lib/openai";
import { MODELS } from "@/lib/models";
import {
  buildSystemPrompt,
  SAFE_DEFAULT_SYSTEM_PROMPT,
  readSessionConstitutionShas,
  writeSessionConstitutionShas,
  diffConstitutionShas,
  renderConstitutionDiffBlock,
} from "@/lib/constitution";
import { ISSUE_DRAFT_PROTOCOL } from "@/lib/issue-draft-protocol";
import { PR_ACTION_PROTOCOL } from "@/lib/pr-action-protocol";
import { TASK_COMPLETE_PROTOCOL } from "@/lib/task-complete-protocol";

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
 * Inserts the user message, builds the WARP🔹CMD system prompt from the
 * live constitution (Phase 3a), streams the assistant reply, and inserts
 * the final assistant message after streaming completes.
 *
 * Response: text/plain chunked stream.
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

  let systemPrompt: string;
  let warnings: string[] = [];
  let promptSource: "live" | "safe_default" = "live";
  let tier1Files: Awaited<ReturnType<typeof buildSystemPrompt>>["tier1Files"] =
    [];
  try {
    const built = await buildSystemPrompt(content);
    systemPrompt = built.prompt;
    warnings = built.warnings;
    promptSource = built.source;
    tier1Files = built.tier1Files;
  } catch (err) {
    systemPrompt = SAFE_DEFAULT_SYSTEM_PROMPT;
    promptSource = "safe_default";
    const reason =
      err instanceof Error ? err.message : "constitution unavailable";
    warnings = [`Safe-default mode: constitution unreachable (${reason}).`];
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

  // Per-session SHA drift detection (Task #9).
  //
  // Compare the SHAs of the Tier-1 files we just loaded against whatever
  // this session saw on its previous turn. If anything changed, append a
  // brief heads-up block to the system prompt so the model can adapt
  // instead of silently contradicting earlier replies. Always upsert the
  // current SHAs so the next turn starts from this baseline. Skipped in
  // safe-default mode — we have no reliable SHAs to record there.
  let driftMessage: string | null = null;
  if (promptSource === "live" && tier1Files.length > 0) {
    try {
      const previousShas = await readSessionConstitutionShas(sessionId);
      const diff = diffConstitutionShas(previousShas, tier1Files);
      if (diff.changed.length > 0) {
        const block = renderConstitutionDiffBlock(diff);
        if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
        driftMessage = `Constitution updated mid-session: ${diff.changed
          .map((c) => c.path)
          .join(", ")}`;
      }
      // Await the baseline upsert. In a streaming Route Handler an
      // unawaited write can be cut off when the response stream
      // completes, which would silently drop the new baseline and cause
      // the same drift notice to fire again on the next turn.
      await writeSessionConstitutionShas(sessionId, tier1Files);
    } catch (err) {
      // Drift detection is best-effort. A failure here must not block
      // the assistant reply — log and continue.
      console.error(
        `[chat] constitution drift check failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (warnings.length > 0) {
    const level = promptSource === "safe_default" ? "error" : "warn";
    const { error: warnErr } = await supabase.from("chat_warnings").insert(
      warnings.map((message) => ({
        session_id: sessionId,
        level,
        message,
      })),
    );
    if (warnErr) {
      console.error(
        `[chat] failed to insert chat_warnings (${warnings.length} rows, level=${level}): ${warnErr.message}`,
      );
    }
  }

  if (driftMessage) {
    const { error: driftErr } = await supabase.from("chat_warnings").insert({
      session_id: sessionId,
      level: "info",
      message: driftMessage,
    });
    if (driftErr) {
      console.error(
        `[chat] failed to insert constitution-drift info row: ${driftErr.message}`,
      );
    }
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
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
          max_tokens: 8192,
          messages,
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
