/* CampusConnect service worker: makes the site installable and shows push notifications.
 * It deliberately caches nothing, so the app is always the latest version. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { title: "CampusConnect", body: event.data ? event.data.text() : "" };
    }
    const title = data.title || "CampusConnect";
    event.waitUntil(
        (async () => {
            const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            // Open tabs update their red dot and unread badge straight away.
            tabs.forEach((tab) => tab.postMessage({ type: "push", kind: data.kind || null, conversationId: data.conversationId || null }));
            // A message while the app is open in front of you shows as an in-app banner instead.
            if (data.kind === "chat" && tabs.some((tab) => tab.visibilityState === "visible" && tab.focused)) return;
            await self.registration.showNotification(title, {
                body: data.body || "",
                icon: data.icon || "/icons/icon-192.png",
                badge: "/icons/badge-96.png",
                tag: data.tag || undefined,
                renotify: Boolean(data.tag),
                vibrate: data.kind === "chat" ? [80, 40, 80] : undefined,
                timestamp: Date.now(),
                data: { url: data.url || "/activity" }
            });
        })()
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = new URL(event.notification.data?.url || "/activity", self.location.origin).href;
    event.waitUntil(
        (async () => {
            const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const open = tabs.find((tab) => new URL(tab.url).origin === self.location.origin);
            if (open) {
                await open.focus();
                return open.navigate(url);
            }
            return self.clients.openWindow(url);
        })()
    );
});
