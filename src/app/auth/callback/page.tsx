"use client";

/**
 * Magic-link landing page.
 *
 * The Supabase email link returns the browser here (…/auth/callback) with the
 * session material in the URL. We load the runtime Supabase config, initialise
 * the browser client (which auto-detects the session from the URL via
 * detectSessionInUrl), wait for the session to materialise, then bounce to the
 * app. On failure (expired/!invalid link) we show a recovery message.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase, setBrowserSupabaseConfig } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Load runtime Supabase config (fly.io doesn't bake NEXT_PUBLIC_* at
        // build time) before creating the client.
        try {
          const res = await fetch("/api/config");
          if (res.ok) {
            const cfg = (await res.json()) as {
              supabaseUrl?: string;
              supabaseAnonKey?: string;
            };
            if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
              setBrowserSupabaseConfig(cfg.supabaseUrl, cfg.supabaseAnonKey);
            }
          }
        } catch {
          /* fall through to build-time vars */
        }

        // Creating the client triggers detectSessionInUrl, which parses the
        // tokens the email link returned and establishes the session.
        const supabase = getBrowserSupabase();

        // If the link used the PKCE flow (?code=...), exchange it explicitly.
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          try {
            await supabase.auth.exchangeCodeForSession(code);
          } catch {
            /* implicit flow handles it below */
          }
        }

        // Poll briefly for the session to settle, then land on the app.
        for (let i = 0; i < 25 && !cancelled; i++) {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            if (!cancelled) router.replace("/");
            return;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        if (!cancelled) {
          setError(
            "We couldn't complete sign-in — the link may have expired or already been used. Request a new magic link.",
          );
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Sign-in failed.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-warp-bg text-white px-4">
      <main className="w-full max-w-sm text-center">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-white/45">
          <span className="led-dot led-online" aria-hidden="true" />
          WARP CodX
        </div>
        {error ? (
          <>
            <h1 className="mt-4 text-xl font-semibold text-white">
              Sign-in link problem
            </h1>
            <p className="mt-2 text-sm text-white/60 leading-relaxed">{error}</p>
            <a
              href="/sign-in"
              className="mt-5 inline-block rounded-md bg-warp-blue/90 hover:bg-warp-blue text-white text-sm px-4 py-2 transition-colors"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-semibold text-white">
              Signing you in…
            </h1>
            <p className="mt-2 text-sm text-white/55">
              Finalising your session.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
