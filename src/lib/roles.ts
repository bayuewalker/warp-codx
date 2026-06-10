/**
 * User roles.
 *
 * Two roles: `admin` and `user`. Admin is decided by the `ADMIN_EMAILS` env
 * var (comma-separated, case-insensitive) — env is the source of truth, so
 * adding an email promotes that account on its next request. A `profiles` row
 * is upserted per user as a persistent record.
 *
 * Identity comes from the Supabase session (Authorization: Bearer <token>),
 * resolved by getRequestUser in src/lib/supabase.ts.
 */
import { getRequestUser } from "./supabase";
import { getServerSupabase } from "./supabase";

export type Role = "admin" | "user";

export type AuthedUser = {
  id: string;
  email: string | null;
  role: Role;
};

/** Parsed, normalized ADMIN_EMAILS list. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

export function roleFor(email: string | null | undefined): Role {
  return isAdminEmail(email) ? "admin" : "user";
}

/** Best-effort persist of the profile row. Never throws. */
async function ensureProfile(
  id: string,
  email: string | null,
  role: Role,
): Promise<void> {
  try {
    const supabase = getServerSupabase();
    await supabase.from("profiles").upsert(
      { id, email, role, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
  } catch {
    /* best-effort — a missing profiles table must not block auth */
  }
}

/**
 * Resolve the authenticated user + role from a request. Returns null when no
 * valid session is present (caller responds 401).
 */
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  const user = await getRequestUser(req.headers.get("authorization"));
  if (!user) return null;
  const role = roleFor(user.email);
  await ensureProfile(user.id, user.email, role);
  return { id: user.id, email: user.email, role };
}

/**
 * Resolve the user and require the admin role. Returns null when the caller is
 * unauthenticated OR not an admin (caller responds 401/403 accordingly using
 * the returned discriminant).
 */
export async function requireAdmin(
  req: Request,
): Promise<{ user: AuthedUser } | { error: "unauthenticated" | "forbidden" }> {
  const user = await requireUser(req);
  if (!user) return { error: "unauthenticated" };
  if (user.role !== "admin") return { error: "forbidden" };
  return { user };
}
