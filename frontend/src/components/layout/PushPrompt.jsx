import { useEffect, useState } from "react";
import { BellRing, Share, X } from "lucide-react";
import { pushApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { Button, Switch } from "../ui";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, permission, pushSupported } from "../../lib/push";

const DISMISS_KEY = "cc.pushPromptDismissed";

const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage blocked: the prompt may show again next time.
    }
};

/** Push state for this device: whether it can be switched on, and whether it is. */
export const usePushState = () => {
    const [state, setState] = useState({ ready: false, available: false, on: false, blocked: false, iosNeedsInstall: false });

    const refresh = async () => {
        const iosNeedsInstall = isIos() && !isStandalone();
        if (!pushSupported()) return setState({ ready: true, available: false, on: false, blocked: false, iosNeedsInstall });
        try {
            const [{ data }, subscription] = await Promise.all([pushApi.publicKey(), currentSubscription()]);
            setState({ ready: true, available: Boolean(data.publicKey), on: Boolean(subscription) && permission() === "granted", blocked: permission() === "denied", iosNeedsInstall });
        } catch {
            setState({ ready: true, available: false, on: false, blocked: false, iosNeedsInstall });
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    return [state, refresh];
};

/** Feed card asking to switch on phone notifications (once; it can be dismissed). */
export const PushPrompt = () => {
    const toast = useToast();
    const [state, refresh] = usePushState();
    const [dismissed, setDismissed] = useState(() => read(DISMISS_KEY) === "1");
    const [pending, setPending] = useState(false);

    if (dismissed || !state.ready) return null;
    const iosHint = state.iosNeedsInstall;
    if (!iosHint && (!state.available || state.on || state.blocked)) return null;

    const dismiss = () => {
        write(DISMISS_KEY, "1");
        setDismissed(true);
    };

    const turnOn = async () => {
        setPending(true);
        try {
            await enablePush();
            toast.success("Notifications on — you'll hear about your events even when CampusConnect is closed");
            await refresh();
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="push-prompt" role="region" aria-label="Notifications">
            <span className="push-prompt-icon">
                <BellRing size={20} />
            </span>
            <span className="push-prompt-text">
                <strong>{iosHint ? "Get CampusConnect on your home screen" : "Turn on notifications"}</strong>
                <span>
                    {iosHint ? (
                        <>
                            Tap <Share size={13} aria-label="Share" /> then “Add to Home Screen”, open it from there and switch on notifications for reminders, offers and results.
                        </>
                    ) : (
                        "Event reminders, offers, results and team invites — even when the app is closed."
                    )}
                </span>
            </span>
            {!iosHint && (
                <Button size="sm" onClick={turnOn} loading={pending}>
                    Turn on
                </Button>
            )}
            <button type="button" className="push-prompt-close" onClick={dismiss} aria-label="Not now">
                <X size={16} />
            </button>
        </div>
    );
};

/** Settings switch: notifications on this device. */
export const PushSetting = () => {
    const toast = useToast();
    const [state, refresh] = usePushState();
    const [pending, setPending] = useState(false);

    if (!state.ready) return null;

    const toggle = async (on) => {
        setPending(true);
        try {
            if (on) await enablePush();
            else await disablePush();
            await refresh();
            toast.success(on ? "Notifications on for this device" : "Notifications off for this device");
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    const description = state.iosNeedsInstall
        ? "On iPhone and iPad, add CampusConnect to your Home Screen (Share → Add to Home Screen) and open it from there to switch this on."
        : !pushSupported()
          ? "This browser can't show notifications."
          : !state.available
            ? "Not available yet — the university hasn't switched push on."
            : state.blocked
              ? "Blocked in this browser. Allow notifications for this site in your browser settings, then come back."
              : "Reminders, offers, results and team invites on this phone or computer, even when CampusConnect is closed.";

    return (
        <Switch
            checked={state.on}
            onChange={toggle}
            disabled={pending || state.iosNeedsInstall || !state.available || state.blocked}
            label="Notifications on this device"
            description={description}
        />
    );
};
