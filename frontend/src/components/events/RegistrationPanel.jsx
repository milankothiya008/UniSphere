import { useState } from "react";
import { CalendarCheck2, CalendarX2, Info } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Button, CapacityBar, Card, ConfirmDialog, StatusBadge } from "../ui";
import { formatDateTime } from "../../lib/format";
import { eligibilityProblem } from "../../lib/eligibility";

const STATE_MESSAGES = {
    NOT_OPEN: (event) => `Registration opens ${formatDateTime(event.registrationStart)}.`,
    CLOSED: () => "Registration for this event has closed.",
    FULL: () => "This event is full.",
    UNAVAILABLE: () => "Registration is not available for this event."
};

export const RegistrationPanel = ({ event, onChange }) => {
    const { user, isStudent } = useAuth();
    const toast = useToast();
    const [pending, setPending] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);

    const registered = event.viewer?.registration?.status === "REGISTERED";
    const beforeStart = new Date(event.startAt) > new Date();
    const problem = isStudent ? eligibilityProblem(user, event) : null;
    const state = event.registrationState;

    const register = async () => {
        setPending(true);
        try {
            await eventApi.register(event._id);
            toast.success("You're registered! A confirmation was sent to your email.");
            onChange();
        } catch (error) {
            toast.error(error);
            onChange();
        } finally {
            setPending(false);
        }
    };

    const cancel = async () => {
        await eventApi.unregister(event._id);
        toast.success("Your registration was cancelled");
        onChange();
    };

    if (!["PUBLISHED", "COMPLETED"].includes(event.status)) {
        return null;
    }

    return (
        <Card title="Registration" actions={<StatusBadge status={registered ? "REGISTERED" : state} />}>
            <div className="stack">
                <CapacityBar registered={event.registeredCount} max={event.maxParticipants} />
                <div className="subtle">Deadline: {formatDateTime(event.registrationEnd)}</div>

                {event.status === "COMPLETED" && <Alert type="info">This event has ended.</Alert>}

                {event.status === "PUBLISHED" && !isStudent && (
                    <Alert type="info">
                        <Info size={14} style={{ verticalAlign: "-2px" }} /> Only student accounts can register for events.
                    </Alert>
                )}

                {event.status === "PUBLISHED" && isStudent && registered && (
                    <>
                        <Alert type="success" title="You're registered">
                            See you there! You'll get notifications about updates to this event.
                        </Alert>
                        {beforeStart && (
                            <Button variant="secondary" block onClick={() => setConfirmCancel(true)}>
                                <CalendarX2 size={16} /> Cancel registration
                            </Button>
                        )}
                    </>
                )}

                {event.status === "PUBLISHED" && isStudent && !registered && (
                    <>
                        {state !== "OPEN" && <Alert type="warning">{STATE_MESSAGES[state]?.(event)}</Alert>}
                        {state === "OPEN" && problem && <Alert type="warning">{problem}</Alert>}
                        <Button size="lg" block loading={pending} disabled={state !== "OPEN" || Boolean(problem)} onClick={register}>
                            <CalendarCheck2 size={17} /> Register now
                        </Button>
                    </>
                )}
            </div>
            <ConfirmDialog
                open={confirmCancel}
                onClose={() => setConfirmCancel(false)}
                onConfirm={cancel}
                title="Cancel your registration?"
                description="Your seat will be released for other students. You can register again while registration is open."
                confirmLabel="Cancel registration"
                variant="danger"
            />
        </Card>
    );
};
