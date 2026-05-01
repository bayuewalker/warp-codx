/**
 * Phase 4 — Web Push helpers (server-only).
 *
 * `sendPushToAll` fans out a payload to every saved subscription and
 * cleans up endpoints that the push provider has marked permanently
 * dead (HTTP 410 Gone or 404 Not Found). It is fire-and-forget: every
 * caller (merge, close, hold, issue create, constitution refresh)
 * already returned its primary success response before invoking us, so
 * we MUST NEVER throw. All errors are swallowed with a `console.error`.
 *
 * The VAPID identity comes from three Replit Secrets that the user has
 * pre-set:
 *   - VAPID_PUBLIC_KEY  (also exposed to the client via /api/push/vapid-public-key)
 *   - VAPID_PRIVATE_KEY (server-only — never exposed)
 *   - VAPID_EMAIL       (mailto: identifier required by the spec)
 *
 * The `web-push` library's `setVapidDetails` is process-global, so we
 * gate it behind a one-time init and re-throw a clear error if the
 * env vars are missing — the caller will catch and log.
 */
import webpush, { type PushSubscription, type WebPushError } from "web-push";
import { getServerSupabase } from "@/lib/supabase";

let _vapidInitialized = false;

function initVapid(): void {
  if (_vapidInitialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL;
  if (!publicKey || !privateKey || !email) {
    throw new Error(
      "VAPID env not configured — need VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL",
    );
  }
  // The web-push library accepts either a `mailto:` URL or a plain
  // email; normalize to `mailto:` so we don't depend on the user
  // pre-formatting the secret.
  const subject = email.startsWith("mailto:") ? email : `mailto:${email}`;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  _vapidInitialized = true;
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  /** Deep-link URL opened when the user taps the notification. `null` keeps the user in the app. */
  url?: string | null;
  /** Optional icon override; defaults to /icon-192.png in the SW. */
  icon?: string;
};

type SubRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function isWebPushError(err: unknown): err is WebPushError {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  );
}

/**
 * Send a payload to every saved push subscription. Returns silently
 * on success or any failure. Best-effort — the calling route's
 * response has already been computed and committed by the time we
 * fire.
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  try {
    initVapid();
  } catch (err) {
    console.error(
      `[push] VAPID init failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return;
  }

  let subs: SubRow[] = [];
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth");
    if (error) {
      console.error(`[push] supabase select failed: ${error.message}`);
      return;
    }
    subs = (data ?? []) as SubRow[];
  } catch (err) {
    console.error(
      `[push] supabase select threw: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return;
  }

  if (subs.length === 0) return;

  const json = JSON.stringify(payload);
  const expiredEndpoints: string[] = [];

  // Wrap the entire fanout + GC in a master try/catch so that if
  // `webpush.sendNotification` ever throws SYNCHRONOUSLY (rather than
  // returning a rejected promise — possible for malformed subscription
  // rows or future library changes), the error is contained and the
  // caller is never affected.
  try {
    // Defensive `Promise.resolve().then(...)` per send guarantees
    // every invocation surfaces as a rejected promise (not a sync
    // throw), so `Promise.allSettled` always reaches every entry.
    const results = await Promise.allSettled(
      subs.map((sub) => {
        const subscription: PushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        return Promise.resolve().then(() =>
          webpush.sendNotification(subscription, json),
        );
      }),
    );

    // Garbage-collect endpoints the push provider has permanently
    // rejected (browser cleared subscription, user uninstalled PWA, etc).
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const reason = r.reason;
        const code = isWebPushError(reason) ? reason.statusCode : null;
        if (code === 410 || code === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        } else {
          console.error(
            `[push] send failed for endpoint (status=${code ?? "?"}): ${
              reason instanceof Error ? reason.message : String(reason)
            }`,
          );
        }
      }
    });
  } catch (err) {
    console.error(
      `[push] fanout threw unexpectedly: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
    return;
  }

  if (expiredEndpoints.length > 0) {
    try {
      const supabase = getServerSupabase();
      const { error } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);
      if (error) {
        console.error(
          `[push] failed to GC ${expiredEndpoints.length} expired sub(s): ${error.message}`,
        );
      } else {
        console.log(`[push] GCed ${expiredEndpoints.length} expired sub(s)`);
      }
    } catch (err) {
      console.error(
        `[push] GC threw: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }
}

/**
 * Returns the public VAPID key for the client to use when calling
 * `pushManager.subscribe`. Pure read of the env var — no network IO.
 */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}
