import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Repeat } from "lucide-react";
import { Badge, Button, Modal } from "../ui";
import { formatEventDates, formatEventTimes } from "../../lib/format";

// A student can't hold places at two events at the same time. When they try, they're shown what overlaps and
// what giving it up means, and can switch — the other place is cancelled first (only before that event starts).

const ROLE = { LEADER: "Team leader", MEMBER: "Team member" };

const consequence = (clash) => {
    if (!clash.canSwitch) return "Already started — you can't switch from it.";
    if (clash.teamRole === "LEADER") return "Your whole team will be withdrawn and your teammates notified.";
    if (clash.teamRole === "MEMBER") return "You'll leave your team. The team keeps its place.";
    if (clash.status === "WAITLISTED") return "You'll lose your place on its waitlist.";
    return "Your seat will go to the next student waiting.";
};

/** The events that overlap, with what switching would do to each. */
export const ClashList = ({ clashes, compact = false }) => (
    <ul className={`clash-list ${compact ? "is-compact" : ""}`}>
        {clashes.map((clash) => (
            <li key={clash.event._id} className={clash.canSwitch ? "" : "is-locked"}>
                <span className="clash-icon">
                    <CalendarClock size={18} />
                </span>
                <span className="clash-body">
                    <Link to={`/events/${clash.event._id}`}>
                        <strong>{clash.event.title}</strong>
                    </Link>
                    <span className="subtle small">
                        {formatEventDates(clash.event.startAt, clash.event.endAt)} · {formatEventTimes(clash.event.startAt, clash.event.endAt)}
                        {clash.event.club?.name ? ` · ${clash.event.club.name}` : ""}
                    </span>
                    {!compact && <span className="clash-effect small">{consequence(clash)}</span>}
                </span>
                <Badge tone={clash.status === "WAITLISTED" ? "warning" : "info"}>
                    {ROLE[clash.teamRole] || (clash.status === "WAITLISTED" ? "Waitlisted" : "Registered")}
                </Badge>
            </li>
        ))}
    </ul>
);

export const ScheduleClashDialog = ({ state, onCancel, onConfirm, pending }) => {
    if (!state) return null;
    const { clashes, eventTitle, full } = state;
    const locked = clashes.some((clash) => !clash.canSwitch);
    return (
        <Modal
            open
            onClose={pending ? undefined : onCancel}
            title={clashes.length === 1 ? "You have another event at this time" : `You have ${clashes.length} events at this time`}
            description={
                locked
                    ? "You can't be at two events at once, and one of them has already started."
                    : `You can't be at two events at once. Switch to ${eventTitle ? `"${eventTitle}"` : "this event"} by giving up ${clashes.length === 1 ? "this one" : "these"}, or keep what you have.`
            }
            footer={
                locked ? (
                    <Button onClick={onCancel}>OK</Button>
                ) : (
                    <>
                        <Button variant="secondary" onClick={onCancel} disabled={pending}>
                            Keep my registration
                        </Button>
                        <Button onClick={onConfirm} loading={pending}>
                            <Repeat size={16} /> Switch
                        </Button>
                    </>
                )
            }
        >
            <div className="stack">
                <ClashList clashes={clashes} />
                {full && !locked && (
                    <p className="clash-note small">
                        This event is full, so you'll join its <strong>waitlist</strong> — you'd give up a confirmed place for a place in the queue.
                    </p>
                )}
            </div>
        </Modal>
    );
};

/**
 * Runs a registration and handles "same time as another event":
 *   attempt((extra) => eventApi.register(id, { ...body, ...extra }))  — asks to switch if the server reports a
 *   clash, then retries with { replace: [...] }. Resolves to the response, or null if the student kept what
 *   they had. confirm(clashes) asks first (when the page already knows) and resolves to the ids to replace or null.
 */
export const useClashSwitch = ({ eventTitle, full } = {}) => {
    const [state, setState] = useState(null);
    const [pending, setPending] = useState(false);
    const pendingCall = useRef(null);

    const ask = useCallback(
        (clashes, call) =>
            new Promise((resolve, reject) => {
                pendingCall.current = { call, resolve, reject };
                setState({ clashes, eventTitle, full });
            }),
        [eventTitle, full]
    );

    const attempt = useCallback(
        async (call, extra = {}) => {
            try {
                return await call(extra);
            } catch (error) {
                if (error?.code === "SCHEDULE_CONFLICT" && error.details?.clashes?.length) return ask(error.details.clashes, call);
                throw error;
            }
        },
        [ask]
    );

    const confirm = useCallback((clashes) => ask(clashes, null), [ask]);

    const onCancel = () => {
        pendingCall.current?.resolve(null);
        pendingCall.current = null;
        setState(null);
    };

    const onConfirm = async () => {
        const current = pendingCall.current;
        const replace = state.clashes.map((clash) => clash.event._id);
        if (!current.call) {
            // Asked up front: the caller carries on (e.g. opens the registration form) with these ids.
            current.resolve(replace);
            pendingCall.current = null;
            setState(null);
            return;
        }
        setPending(true);
        try {
            const result = await current.call({ replace });
            current.resolve(result);
            pendingCall.current = null;
            setState(null);
        } catch (error) {
            if (error?.code === "SCHEDULE_CONFLICT" && error.details?.clashes?.length) {
                // Something else overlaps now (or one started): show the up-to-date list.
                setState((previous) => ({ ...previous, clashes: error.details.clashes }));
            } else {
                current.reject(error);
                pendingCall.current = null;
                setState(null);
            }
        } finally {
            setPending(false);
        }
    };

    return { attempt, confirm, dialog: <ScheduleClashDialog state={state} onCancel={onCancel} onConfirm={onConfirm} pending={pending} /> };
};

/** "Switched from X" for toasts after a switch. */
export const switchedText = (response) => {
    const from = response?.data?.switchedFrom || [];
    return from.length ? ` Your place in ${from.map((event) => `"${event.title}"`).join(" and ")} was cancelled.` : "";
};
