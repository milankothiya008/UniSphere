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
            await self.registration.showNotification(title, {
                body: data.body || "",
                icon: "/icons/icon-192.png",
                badge: "/icons/badge-96.png",
                tag: data.tag || undefined,
                renotify: Boolean(data.tag),
                data: { url: data.url || "/activity" }
            });
            // Open tabs update their red dot straight away.
            const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            tabs.forEach((tab) => tab.postMessage({ type: "push" }));
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
