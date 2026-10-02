// Installable app + Web Push on this device. Everything here is optional: browsers without support
// simply keep using the in-app Activity list.
import { pushApi } from "../api/endpoints";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

/** Opened from the home-screen icon (installed app) rather than a browser tab. */
export const isStandalone = () =>
    typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

export const permission = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

let registration = null;

export const registerServiceWorker = async () => {
    if (!("serviceWorker" in navigator)) return null;
    try {
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        return registration;
    } catch {
        return null;
    }
};

const ready = async () => registration || (await navigator.serviceWorker.ready);

const keyBytes = (base64) => {
    const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(padded);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

/** This device's current push subscription, if any. */
export const currentSubscription = async () => {
    if (!pushSupported()) return null;
    const reg = await ready();
    return reg.pushManager.getSubscription();
};

/** Asks for permission (must be called from a tap) and subscribes this device. */
export const enablePush = async () => {
    if (!pushSupported()) throw new Error("This browser can't show notifications");
    const { data } = await pushApi.publicKey();
    if (!data.publicKey) throw new Error("Notifications aren't switched on for CampusConnect yet");
    const result = await Notification.requestPermission();
    if (result !== "granted") throw new Error(result === "denied" ? "Notifications are blocked — allow them in your browser's site settings" : "Notifications weren't allowed");
    const reg = await ready();
    const subscription = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) }));
    await pushApi.subscribe(subscription.toJSON());
    return subscription;
};

/** Turns push off on this device (also used when signing out). */
export const disablePush = async () => {
    const subscription = await currentSubscription().catch(() => null);
    if (!subscription) return;
    await pushApi.unsubscribe(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
};
