import { useState } from "react";
import { CalendarCheck2, CalendarX2, Hourglass, Info, ListPlus, LogOut } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Button, CapacityBar, Card, ConfirmDialog, StatusBadge } from "../ui";
import { formatDateTime, plural } from "../../lib/format";
import { eligibilityProblem } from "../../lib/eligibility";

const STATE_MESSAGES = {
    NOT_OPEN: (event) => `Registration opens ${formatDateTime(event.registrationStart)}.`,
    CLOSED: () => "Registration for this event has closed.",
    UNAVAILABLE: () => "Registration is not available for this event."
};

export const RegistrationPanel = ({ event, onChange }) => {
    const { user, isStudent } = useAuth();
    const toast = useToast();
    const [pending, setPending] = useState(false);
    const [dialog, setDialog] = useState(null);

    const registration = event.viewer?.registration;
    const registered = registration?.status === "REGISTERED";
    const waitlisted = registration?.status === "WAITLISTED";
    const beforeStart = new Date(event.startAt) > new Date();
    const problem = isStudent ? eligibilityProblem(user, event) : null;
    const state = event.registrationState;
    const full = state === "FULL";
    const waiting = event.waitlistCount || 0;

    const register = async () => {
        setPending(true);
        try {
            const response = await eventApi.register(event._id);
            if (response.data?.waitlisted) {
                toast.info(`The event is full — you're #${response.data.waitlistPosition} on the waitlist. We'll email you if a seat opens up.`);
            } else {
                toast.success("You're registered! A confirmation was sent to your email.");
            }
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
        toast.success(waitlisted ? "You left the waitlist" : "Your registration was cancelled");
        onChange();
    };

    if (!["PUBLISHED", "COMPLETED"].includes(event.status)) {
        return null;
    }

    const badge = registered ? "REGISTERED" : waitlisted ? "WAITLISTED" : state;

    return (
        <Card title="Registration" actions={<StatusBadge status={badge} />}>
            <div className="stack">
                <CapacityBar registered={event.registeredCount} max={event.maxParticipants} />
                {waiting > 0 && (
                    <div className="subtle row" style={{ gap: 6 }}>
                        <Hourglass size={13} /> {plural(waiting, "student")} on the waitlist
                    </div>
                )}
                <div className="subtle">Deadline: {formatDateTime(event.registrationEnd)}</div>

                {event.status === "COMPLETED" && <Alert type="info">This event has ended.</Alert>}

                {event.status === "PUBLISHED" && !isStudent && (
                    <Alert type="info">
                        <Info size={14} style={{ verticalAlign: "-2px" }} /> Only student accounts can register for events.
                    </Alert>
                )}

                {event.status === "PUBLISHED" && isStudent && registered && (
                    <>
                        <Alert type="success" title={registration.promotedAt ? "You got a seat from the waitlist" : "You're registered"}>
                            See you there! You'll get notifications about updates to this event.
                        </Alert>
                        {beforeStart && (
                            <Button variant="secondary" block onClick={() => setDialog("cancel")}>
                                <CalendarX2 size={16} /> Cancel registration
                            </Button>
                        )}
                    </>
                )}

                {event.status === "PUBLISHED" && isStudent && waitlisted && (
                    <>
                        <div className="waitlist-spot">
                            <span className="waitlist-number">#{registration.waitlistPosition}</span>
                            <div>
                                <strong>You're on the waitlist</strong>
                                <p className="muted small" style={{ margin: 0 }}>
                                    {registration.waitlistPosition === 1 ? "You're next in line." : `${registration.waitlistPosition - 1} ahead of you.`} If a seat opens up before the event
                                    starts, you'll be registered automatically and we'll email you.
                                </p>
                            </div>
                        </div>
                        {beforeStart && (
                            <Button variant="secondary" block onClick={() => setDialog("leave")}>
                                <LogOut size={16} /> Leave waitlist
                            </Button>
                        )}
                    </>
                )}

                {event.status === "PUBLISHED" && isStudent && !registered && !waitlisted && (
                    <>
                        {!["OPEN", "FULL"].includes(state) && <Alert type="warning">{STATE_MESSAGES[state]?.(event)}</Alert>}
                        {["OPEN", "FULL"].includes(state) && problem && <Alert type="warning">{problem}</Alert>}
                        {full && !problem && (
                            <Alert type="info" title="All seats are taken">
                                Join the waitlist{waiting ? ` (${plural(waiting, "student")} ahead of you)` : ""}. If someone cancels, the first person waiting is registered
                                automatically and emailed.
                            </Alert>
                        )}
                        <Button size="lg" block variant={full ? "secondary" : "primary"} loading={pending} disabled={!["OPEN", "FULL"].includes(state) || Boolean(problem)} onClick={register}>
                            {full ? <ListPlus size={17} /> : <CalendarCheck2 size={17} />} {full ? "Join waitlist" : "Register now"}
                        </Button>
                    </>
                )}
            </div>
            <ConfirmDialog
                open={dialog === "cancel"}
                onClose={() => setDialog(null)}
                onConfirm={cancel}
                title="Cancel your registration?"
                description={
                    waiting
                        ? "Your seat will go to the first student on the waitlist. If you change your mind, you'll join the back of the waitlist."
                        : "Your seat will be released for other students. You can register again while registration is open."
                }
                confirmLabel="Cancel registration"
                variant="danger"
            />
            <ConfirmDialog
                open={dialog === "leave"}
                onClose={() => setDialog(null)}
                onConfirm={cancel}
                title="Leave the waitlist?"
                description="You'll lose your place in the queue. Joining again puts you at the back."
                confirmLabel="Leave waitlist"
                variant="danger"
            />
        </Card>
    );
};
