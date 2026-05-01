/**
 * Phase 4 — Web Push helpers (browser-only).
 *
 * Wraps the awkward Service Worker / Push API ceremony into four
 * functions the UI can consume directly:
 *
 *   - `isPushSupported()` — feature-detect the entire chain.
 *   - `getPushPermission()` — current Notification permission.
 *   - `getCurrentSubscription()` — existing PushSubscription (if any).
 *   - `subscribePush()` — request permission, register SW, subscribe,
 *                        POST /api/push/subscribe.
 *   - `unsubscribePush()` — POST /api/push/unsubscribe + unsubscribe locally.
 *
 * All functions are no-ops on the server (typeof window === "undefined")
 * and return defensive shapes so SSR doesn't blow up.
 *
 * The VAPID public key is fetched from /api/push/vapid-public-key on
 * demand (cached for the page lifetime).
 */
import { prsFetch } from "@/lib/prs-fetch";

const SW_PATH = "/sw.js";

let _vapidKeyCache: string | null = null;

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Convert the urlBase64 VAPID public key into the Uint8Array format
 * `pushManager.subscribe` requires. Standard ceremony from the Web
 * Push spec.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // Back the view with a fresh ArrayBuffer (not the default
  // ArrayBufferLike) so the result satisfies `BufferSource` for
  // `pushManager.subscribe`'s `applicationServerKey` field under
  // TS lib.dom 5.x. Without the explicit `<ArrayBuffer>` generic
  // the inferred type widens to `Uint8Array<ArrayBufferLike>` and
  // becomes incompatible with `ArrayBufferView<ArrayBuffer>`.
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidPublicKey(): Promise<string> {
  if (_vapidKeyCache) return _vapidKeyCache;
  const res = await fetch("/api/push/vapid-public-key", { cache: "no-store" });
  if (!res.ok) throw new Error(`vapid key fetch failed (HTTP ${res.status})`);
  const json = (await res.json()) as { publicKey?: string };
  if (!json.publicKey) throw new Error("vapid key fetch returned no key");
  _vapidKeyCache = json.publicKey;
  return _vapidKeyCache;
}

/**
 * Register the service worker once and reuse the registration. On
 * second call, returns the cached registration without re-registering.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) {
    throw new Error("push not supported in this browser");
  }
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH);
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Full subscribe flow: ask permission (if needed) → register SW →
 * subscribe via PushManager → POST to /api/push/subscribe. Returns
 * the resulting PushSubscription on success.
 *
 * Throws on:
 *   - push not supported
 *   - permission denied / dismissed
 *   - PushManager.subscribe failure
 *   - server reject
 */
export async function subscribePush(): Promise<PushSubscription> {
  if (!isPushSupported()) {
    throw new Error("push notifications are not supported in this browser");
  }

  if (Notification.permission === "denied") {
    throw new Error(
      "notifications are blocked — enable them in site settings to continue",
    );
  }

  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      throw new Error("notification permission not granted");
    }
  }

  const reg = await registerServiceWorker();

  // Reuse an existing subscription if one already exists for this
  // browser — re-subscribing returns the same object anyway.
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(await fetchVapidPublicKey()),
    }));

  // Persist on the server. The endpoint is the canonical identity so
  // re-subscribing from the same browser is a no-op upsert. Subscribe
  // is intentionally NOT admin-gated — anyone with the URL who has
  // physical access to the device should be able to opt themselves in
  // or out. The admin token is only required for /api/push/test.
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`subscribe POST failed (HTTP ${res.status}) ${text}`);
  }
  return subscription;
}

/**
 * Tell the server to forget us, then unsubscribe locally. Both legs
 * are best-effort — we always attempt the local unsubscribe even if
 * the server call fails.
 */
export async function unsubscribePush(): Promise<void> {
  if (!isPushSupported()) return;
  const sub = await getCurrentSubscription();
  if (!sub) return;
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch (err) {
    console.error(
      `[push-client] server unsubscribe failed: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
  try {
    await sub.unsubscribe();
  } catch (err) {
    console.error(
      `[push-client] local unsubscribe failed: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}

/**
 * Send a test push by hitting /api/push/test. The server fans out to
 * all subscriptions including this one.
 */
export async function sendTestPush(): Promise<void> {
  // Admin-gated via prsFetch so the same WARP_ADMIN_TOKEN that
  // protects /api/prs/* also protects test pushes (preventing a
  // public-deploy abuse vector). In dev/preview the gate is permissive.
  const res = await prsFetch("/api/push/test", { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`test push failed (HTTP ${res.status}) ${text}`);
  }
}
