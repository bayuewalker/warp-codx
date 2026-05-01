import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Task #37 — paginated session list.
 *
 * Sessions are returned newest-first (ORDER BY created_at DESC, id DESC).
 * The sidebar only shows ~10 at a time on phones, so shipping the entire
 * history on first load wastes bandwidth and JSON-parse time once the
 * archive grows. We page using a tuple cursor over (created_at, id)
 * plus a `limit` (default 10, max 50).
 *
 * Why a tuple cursor: a strict `created_at < before` filter would skip
 * rows that share the exact `created_at` of the last visible item at a
 * page boundary. The `(created_at, id)` tuple breaks that tie
 * deterministically — `id` is a UUID per the schema, so sorting by it
 * within a created_at group is stable and total. The matching SQL
 * predicate is:
 *
 *   (created_at < before) OR (created_at = before AND id < beforeId)
 *
 * Performance: the matching `sessions_created_at_id_idx` composite
 * index in `supabase.sql` (created_at desc, id desc) lets Postgres
 * satisfy this ORDER BY + tuple keyset filter as a pure index range
 * scan touching only ~limit rows, so "Show more" stays snappy even
 * when the sessions table grows into the tens of thousands. Keep the
 * ORDER BY columns and predicate aligned with that index — changing
 * either side without the other will silently regress to a full sort.
 *
 * Response shape:
 *   {
 *     sessions: Session[],
 *     hasMore: boolean,
 *     nextCursor: string | null,   // created_at of the last visible row
 *     nextCursorId: string | null, // id of the last visible row
 *   }
 *
 * Pass `nextCursor` back as `?before=` and `nextCursorId` as `?beforeId=`
 * to fetch the next page. `null` for either means we're at the end.
 */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;
    const before = url.searchParams.get("before");
    const beforeId = url.searchParams.get("beforeId");

    const supabase = getServerSupabase();
    let query = supabase
      .from("sessions")
      .select("id, label, created_at, updated_at")
      .order("created_at", { ascending: false })
      // Stable secondary sort breaks ties on `created_at`. Combined with
      // the tuple cursor below, this guarantees no row is ever skipped
      // or duplicated across page boundaries even if two sessions share
      // the exact same `created_at`.
      .order("id", { ascending: false })
      // Fetch one extra row to detect whether more pages exist without
      // a separate count query.
      .limit(limit + 1);

    if (before) {
      // Tuple keyset condition. PostgREST `.or(...)` accepts a
      // comma-separated list of clauses; nested `and(...)` groups the
      // tie-breaker pair. When `beforeId` is missing (legacy callers),
      // we fall back to the strict-less-than form.
      if (beforeId) {
        query = query.or(
          `created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`,
        );
      } else {
        query = query.lt("created_at", before);
      }
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const sessions = hasMore ? rows.slice(0, limit) : rows;
    const last = hasMore && sessions.length > 0 ? sessions[sessions.length - 1] : null;
    const nextCursor = last ? last.created_at : null;
    const nextCursorId = last ? last.id : null;

    return NextResponse.json({ sessions, hasMore, nextCursor, nextCursorId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      label?: string;
    };
    const label =
      typeof body.label === "string" && body.label.trim().length > 0
        ? body.label.trim().slice(0, 120)
        : `New directive · ${new Date().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}`;

    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .insert({ label })
      .select("id, label, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ session: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
