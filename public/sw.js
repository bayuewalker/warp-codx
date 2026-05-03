/**
 * WARP CodX — service worker.
 *
 * Two responsibilities:
 *   1. Web Push notifications (`push` + `notificationclick`).
 *   2. Minimal app-shell caching so the installed PWA loads instantly
 *      on subsequent visits, even on a flaky cellular connection.
 *
 * Caching strategy (deliberately conservative — chat is online-only):
 *   - Static assets under `/_next/static/*` and `/icons/*` plus the
 *     manifest are cached with a cache-first strategy. They are
 *     content-hashed (Next builds) or stable, so cache-first is safe.
 *   - HTML navigations use a network-first strategy with a cached
 *     fallback so the home shell still appears when offline.
 *   - Everything else (API routes, `/api/*`, third-party fetches) is
 *     passed straight to the network. We never want a stale chat
 *     response or a cached auth token.
 */
const CACHE_VERSION = "warp-codx-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// The minimal set of URLs that make up the launchable home-screen
// shell. Pre-cached on install so the first launch from the home
// screen works offline.
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // Activate immediately on first install so the very first push after
  // the user opts in actually has a controller listening.
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // `addAll` is atomic — if any URL fails the whole install
        // fails. Use individual `add` calls so a missing optional
        // asset doesn't kill the install.
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`[sw] precache miss for ${url}`, err);
            }),
          ),
        ),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Drop any caches from previous CACHE_VERSIONs.
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Only handle same-origin requests — never intercept third-party
  // (analytics, fonts CDN, etc).
  if (url.origin !== self.location.origin) return;

  // Never cache API or auth routes — chat / PR / push endpoints must
  // always hit the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Cache-first for stable static assets.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";

  if (isStatic) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      }),
    );
    return;
  }

  // Network-first for HTML navigations, with cached shell fallback.
  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Refresh cached copy of the home shell.
          if (res && res.ok && url.pathname === "/") {
            const cache = await caches.open(SHELL_CACHE);
            cache.put("/", res.clone());
          }
          return res;
        } catch (err) {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match(req)) || (await cache.match("/"));
          if (cached) return cached;
          throw err;
        }
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    // Some browsers (and the web-push test endpoint) deliver a plain
    // string. Fall back to using it as the body so we never silently
    // drop a real push.
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "WARP CodX";
  const body = data.body || "";
  const tag = data.tag || "warp-default";
  const url = data.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: data.icon || "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag,
      data: { url },
      requireInteraction: false,
      silent: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Prefer focusing an existing WARP CodX tab when one exists;
        // only open a new window if none does.
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            // Best-effort navigate the existing tab to the target URL
            // when it differs.
            try {
              if ("navigate" in client && client.url !== targetUrl) {
                client.navigate(targetUrl);
              }
            } catch (_err) {
              /* ignore — focus is the important bit */
            }
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
