import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck2, CalendarX2, Hourglass, Info, ListPlus, LogOut, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, Button, CapacityBar, Card, ConfirmDialog, StatusBadge } from "../ui";
import { formatDateTime, plural } from "../../lib/format";
import { eligibilityProblem } from "../../lib/eligibility";
import { TeamRegisterDialog } from "../teams/TeamRegisterDialog";
import { TeamCard, TeamInvites } from "../teams/TeamCard";
import { TicketCard } from "./TicketCard";

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
    const isTeamEvent = event.participationMode === "TEAM";
    const team = event.viewer?.team;
    const isLeader = event.viewer?.teamRole === "LEADER";
    const invites = event.viewer?.invites || [];
    const canSignUp = ["OPEN", "FULL"].includes(state) && !problem;
    const [params, setParams] = useSearchParams();

    // The feed's "Register team" button links here with ?register=team to open the team form straight away.
    useEffect(() => {
        if (params.get("register") === "team") {
            if (isTeamEvent && isStudent && canSignUp && !registered && !waitlisted) {
                setDialog("team");
            }
            params.delete("register");
            setParams(params, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const register = async () => {
        if (isTeamEvent) {
            setDialog("team");
            return;
        }
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
        const response = await eventApi.unregister(event._id);
        toast.success(response.message || (waitlisted ? "You left the waitlist" : "Your registration was cancelled"));
        onChange();
    };

    if (!["PUBLISHED", "COMPLETED"].includes(event.status)) {
        return null;
    }

    const badge = registered ? "REGISTERED" : waitlisted ? "WAITLISTED" : state;

    return (
        <Card title="Registration" actions={<StatusBadge status={badge} />}>
            <div className="stack">
                {isTeamEvent && (
                    <div className="team-rule">
                        <Users size={15} /> Team event · {event.minTeamSize === event.maxTeamSize ? event.maxTeamSize : `${event.minTeamSize}–${event.maxTeamSize}`} members per team
                    </div>
                )}
                <CapacityBar registered={event.registeredCount} max={event.maxParticipants} teams={isTeamEvent} />
                {waiting > 0 && (
                    <div className="subtle row" style={{ gap: 6 }}>
                        <Hourglass size={13} /> {plural(waiting, isTeamEvent ? "team" : "student")} on the waitlist
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
                        <Alert type="success" title={registration.promotedAt ? "You got a seat from the waitlist" : team ? "Your team is registered" : "You're registered"}>
                            {registration.checkedInAt ? "You're checked in — enjoy the event!" : "Your ticket is below. Show its QR code at the entrance."}
                        </Alert>
                        <TicketCard event={event} registration={registration} />
                        {team && <TeamCard event={event} team={team} isLeader={isLeader} onChange={onChange} />}
                        {beforeStart && (
                            <Button variant="secondary" block onClick={() => setDialog("cancel")}>
                                <CalendarX2 size={16} /> {team ? (isLeader ? "Cancel team registration" : "Leave team") : "Cancel registration"}
                            </Button>
                        )}
                    </>
                )}

                {event.status === "PUBLISHED" && isStudent && waitlisted && (
                    <>
                        <div className="waitlist-spot">
                            <span className="waitlist-number">#{registration.waitlistPosition}</span>
                            <div>
                                <strong>{team ? "Your team is on the waitlist" : "You're on the waitlist"}</strong>
                                <p className="muted small" style={{ margin: 0 }}>
                                    {registration.waitlistPosition === 1 ? "You're next in line." : `${registration.waitlistPosition - 1} ahead of you.`} If a seat opens up before the event
                                    starts, you'll be registered automatically and we'll email you.
                                </p>
                            </div>
                        </div>
                        {team && <TeamCard event={event} team={team} isLeader={isLeader} onChange={onChange} />}
                        {beforeStart && (
                            <Button variant="secondary" block onClick={() => setDialog(team ? "cancel" : "leave")}>
                                <LogOut size={16} /> {team ? (isLeader ? "Withdraw team" : "Leave team") : "Leave waitlist"}
                            </Button>
                        )}
                    </>
                )}

                {event.status === "PUBLISHED" && isStudent && !registered && !waitlisted && (
                    <>
                        {invites.length > 0 && <TeamInvites event={event} invites={invites} onChange={onChange} />}
                        {!["OPEN", "FULL"].includes(state) && <Alert type="warning">{STATE_MESSAGES[state]?.(event)}</Alert>}
                        {["OPEN", "FULL"].includes(state) && problem && <Alert type="warning">{problem}</Alert>}
                        {full && !problem && (
                            <Alert type="info" title="All seats are taken">
                                Join the waitlist{waiting ? ` (${plural(waiting, "student")} ahead of you)` : ""}. If someone cancels, the first person waiting is registered
                                automatically and emailed.
                            </Alert>
                        )}
                        <Button
                            size="lg"
                            block
                            variant={full || invites.length ? "secondary" : "primary"}
                            loading={pending}
                            disabled={!["OPEN", "FULL"].includes(state) || Boolean(problem)}
                            onClick={register}
                        >
                            {isTeamEvent ? <Users size={17} /> : full ? <ListPlus size={17} /> : <CalendarCheck2 size={17} />}{" "}
                            {isTeamEvent ? (invites.length ? "Register your own team instead" : full ? "Join waitlist as a team" : "Register a team") : full ? "Join waitlist" : "Register now"}
                        </Button>
                        {isTeamEvent && !invites.length && (
                            <p className="subtle small" style={{ margin: 0 }}>
                                Joining someone else's team? Ask the leader to invite you — the invite shows up here and in your notifications.
                            </p>
                        )}
                    </>
                )}
            </div>
            <ConfirmDialog
                open={dialog === "cancel"}
                onClose={() => setDialog(null)}
                onConfirm={cancel}
                title={team ? (isLeader ? "Cancel your team's registration?" : `Leave "${team.name}"?`) : "Cancel your registration?"}
                description={
                    team
                        ? isLeader
                            ? "The whole team is withdrawn: your teammates' registrations are cancelled and they're notified. Your team's place goes to the next team waiting."
                            : "You'll no longer be registered. The team keeps its place, and the leader is notified."
                        : waiting
                          ? "Your seat will go to the first student on the waitlist. If you change your mind, you'll join the back of the waitlist."
                          : "Your seat will be released for other students. You can register again while registration is open."
                }
                confirmLabel={team ? (isLeader ? "Cancel team registration" : "Leave team") : "Cancel registration"}
                variant="danger"
            />
            {isTeamEvent && <TeamRegisterDialog open={dialog === "team"} onClose={() => setDialog(null)} event={event} onRegistered={onChange} />}
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
