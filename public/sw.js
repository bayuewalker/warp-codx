/**
 * WARP CodX — service worker for Web Push notifications.
 *
 * Phase 4. Two responsibilities only:
 *   1. `push` event   — render a notification from the JSON payload.
 *   2. `notificationclick` event — focus an existing window or open
 *      the deep link.
 *
 * No fetch/cache strategy here on purpose. The app is fully online and
 * we don't want a stale-asset surprise from an unintentional cache.
 */
self.addEventListener("install", (event) => {
  // Activate immediately on first install so the very first push after
  // the user opts in actually has a controller listening.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
      icon: data.icon || "/icon-192.png",
      badge: "/badge-72.png",
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
