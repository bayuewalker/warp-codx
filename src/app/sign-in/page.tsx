"use client";

/**
 * Task #2 — Sign-in screen (email magic-link).
 *
 * The chat UI is gated on a Supabase Auth session. Unauthenticated
 * visitors land here, type their email, receive a magic link, and
 * are bounced back to `/auth/callback` (which finalises the session
 * and redirects to `/`). No password, no OAuth providers — that's
 * deliberately out of scope per the task plan.
 *
 * Implementation notes:
 *   - The Supabase JS client picks up its access/refresh tokens
 *     from the URL hash automatically (`detectSessionInUrl: true`),
 *     so the only thing this page does is request the OTP and show
 *     "check your email".
 *   - `emailRedirectTo` is built from `NEXT_PUBLIC_APP_URL` so the
 *     magic link in the email always points at the canonical
 *     deployed host, not whatever origin the user happened to load
 *     `/sign-in` from. This matters because Supabase only honours
 *     redirects whose host is in the dashboard's "Redirect URLs"
 *     allow-list, and because the same browser may switch between
 *     the Replit dev preview and the published .replit.app host.
 *     Fallback is the production .replit.app URL — set
 *     `NEXT_PUBLIC_APP_URL=http://localhost:3000` (or the dev
 *     preview URL) when running locally.
 *   - We auto-redirect to `/` if a session is already present, so
 *     pressing "back" from the app doesn't strand the user on a
 *     useless sign-in form.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // If the user already has a session (e.g. they manually navigated
  // to /sign-in while logged in), bounce them straight to the app.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = getBrowserSupabase();
        const { data } = await supabase.auth.getSession();
        if (!cancelled && data.session) {
          router.replace("/");
        }
      } catch {
        /* env not configured — let the form render so the operator
           can see a useful error when they try to send a link. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus({ kind: "sending" });
    try {
      const supabase = getBrowserSupabase();
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://warp-codx.replit.app";
      const redirectTo = `${appUrl.replace(/\/+$/, "")}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
        return;
      }
      setStatus({ kind: "sent", email: trimmed });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Could not send magic link — check the Supabase env vars.",
      });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-warp-bg text-white px-4">
      <main className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-white/45">
            <span className="led-dot led-online" aria-hidden="true" />
            WARP CodX
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-white">
            Sign in to continue
          </h1>
          <p className="mt-2 text-sm text-white/55 leading-relaxed">
            Enter your email and we&rsquo;ll send a one-time magic link.
            No password.
          </p>
        </header>

        {status.kind === "sent" ? (
          <div
            className="rounded-md border border-warp-blue/40 bg-warp-blue/5
              px-4 py-3 text-sm text-white/80 leading-relaxed"
            role="status"
          >
            <strong className="text-white">Check your inbox.</strong>
            <div className="mt-1 text-white/65">
              We sent a sign-in link to{" "}
              <span className="font-mono text-white/90">{status.email}</span>.
              Open it on this device to land back here signed in.
            </div>
            <button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              className="mt-3 text-xs text-warp-blue hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">
                Email address
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-hair
                  bg-black/30 px-3 py-2 text-sm text-white
                  placeholder:text-white/35 focus:outline-none
                  focus:border-warp-blue/70"
                disabled={status.kind === "sending"}
              />
            </label>

            <button
              type="submit"
              disabled={status.kind === "sending" || !email.trim()}
              className="w-full rounded-md bg-warp-blue/90
                hover:bg-warp-blue text-white text-sm py-2.5
                transition-colors disabled:opacity-60
                disabled:cursor-not-allowed"
            >
              {status.kind === "sending"
                ? "Sending magic link…"
                : "Send magic link"}
            </button>

            {status.kind === "error" && (
              <div
                className="rounded-md border border-warp-red/40
                  bg-warp-red/5 px-3 py-2 text-xs text-white/85
                  leading-relaxed"
                role="alert"
              >
                {status.message}
              </div>
            )}
          </form>
        )}

        <p className="mt-8 text-[11px] text-white/35 text-center leading-relaxed">
          Your sessions, messages, and warnings are stored privately
          per account &mdash; no one else can see them, even via the
          public anon key.
        </p>
      </main>
    </div>
  );
}
