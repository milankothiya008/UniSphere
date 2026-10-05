import { useState } from "react";
import { Crown, Hourglass, MailPlus, Send, UserMinus, Users, X } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { batchLabel, timeAgo } from "../../lib/format";
import { Avatar, Badge, Button, ConfirmDialog, Modal } from "../ui";
import { StudentPicker } from "./StudentPicker";
import { RegistrationFormDialog, formQuestions } from "../events/RegistrationFormDialog";
import { switchedText, useClashSwitch } from "../events/ScheduleClash";

const detail = (user) => [user.departmentCode, user.batchCode && `Batch ${batchLabel(user.batchCode)}`].filter(Boolean).join(" · ");

// Filled / required / maximum places on a team, as dots.
const TeamMeter = ({ team }) => (
    <div className="team-meter" aria-label={`${team.size} of up to ${team.maxSize} members`}>
        {Array.from({ length: team.maxSize }, (_, index) => (
            <span key={index} className={index < team.size ? "is-filled" : index < team.minSize ? "is-needed" : ""} />
        ))}
    </div>
);

/** The viewer's team for an event: roster, pending invites and (for the leader) team management. */
export const TeamCard = ({ event, team, isLeader, onChange }) => {
    const toast = useToast();
    const [inviting, setInviting] = useState(false);
    const [picked, setPicked] = useState([]);
    const [sending, setSending] = useState(false);
    const [removing, setRemoving] = useState(null);
    const open = event.status === "PUBLISHED" && new Date(event.registrationEnd) > new Date() && new Date(event.startAt) > new Date();
    const room = team.maxSize - team.size - team.invites.length;
    const missing = Math.max(0, team.minSize - team.size);

    const sendInvites = async () => {
        setSending(true);
        try {
            await eventApi.inviteToTeam(
                event._id,
                picked.map((user) => user._id)
            );
            toast.success(`Invite${picked.length === 1 ? "" : "s"} sent`);
            setInviting(false);
            setPicked([]);
            onChange();
        } catch (error) {
            toast.error(error);
        } finally {
            setSending(false);
        }
    };

    const remove = async () => {
        await eventApi.removeTeamMember(event._id, removing.user._id);
        toast.success(removing.status === "INVITED" ? "Invite withdrawn" : `${removing.user.name} was removed from the team`);
        onChange();
    };

    return (
        <div className="team-card">
            <div className="team-card-head">
                <span className="team-badge" aria-hidden="true">
                    <Users size={18} />
                </span>
                <div className="grow">
                    <strong>{team.name}</strong>
                    <span className="subtle small">
                        {team.size} of {team.minSize === team.maxSize ? team.maxSize : `${team.minSize}–${team.maxSize}`} members
                        {team.registrationStatus === "WAITLISTED" && " · on the waitlist"}
                    </span>
                </div>
                {team.complete ? <Badge tone="success">Complete</Badge> : <Badge tone="warning">Needs {missing} more</Badge>}
            </div>

            <TeamMeter team={team} />

            <ul className="team-roster">
                {team.members.map((member) => (
                    <li key={member.user._id}>
                        <Avatar name={member.user.name} src={member.user.avatar} size="sm" />
                        <span className="grow">
                            <strong>{member.user.name}</strong>
                            <small>{detail(member.user)}</small>
                        </span>
                        {member.status === "LEADER" ? (
                            <span className="team-role">
                                <Crown size={13} /> Leader
                            </span>
                        ) : (
                            isLeader &&
                            open && (
                                <button
                                    type="button"
                                    className="icon-button"
                                    onClick={() => setRemoving(member)}
                                    aria-label={`Remove ${member.user.name}`}
                                    title="Remove from team"
                                >
                                    <UserMinus size={16} />
                                </button>
                            )
                        )}
                    </li>
                ))}
                {team.invites.map((invite) => (
                    <li key={invite.user._id} className="is-invited">
                        <Avatar name={invite.user.name} src={invite.user.avatar} size="sm" />
                        <span className="grow">
                            <strong>{invite.user.name}</strong>
                            <small>
                                <Hourglass size={11} /> Invited {timeAgo(invite.invitedAt)} · waiting for a reply
                            </small>
                        </span>
                        {isLeader && open && (
                            <button
                                type="button"
                                className="icon-button"
                                onClick={() => setRemoving(invite)}
                                aria-label={`Withdraw invite to ${invite.user.name}`}
                                title="Withdraw invite"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </li>
                ))}
            </ul>

            {!team.complete && (
                <p className="team-hint">
                    {isLeader
                        ? `Your team needs ${missing} more member${missing === 1 ? "" : "s"} before registration closes. Invite teammates and ask them to accept.`
                        : `The team needs ${missing} more member${missing === 1 ? "" : "s"} to be complete.`}
                </p>
            )}

            {isLeader && open && room > 0 && (
                <Button variant="secondary" block onClick={() => setInviting(true)}>
                    <MailPlus size={16} /> Invite teammates
                </Button>
            )}

            <Modal
                open={inviting}
                onClose={sending ? undefined : () => setInviting(false)}
                title={`Invite to ${team.name}`}
                description={`You can invite ${room} more student${room === 1 ? "" : "s"}.`}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setInviting(false)} disabled={sending}>
                            Cancel
                        </Button>
                        <Button onClick={sendInvites} loading={sending} disabled={!picked.length}>
                            <Send size={15} /> Send invite{picked.length === 1 ? "" : "s"}
                        </Button>
                    </>
                }
            >
                <StudentPicker
                    eventId={event._id}
                    selected={picked}
                    onChange={setPicked}
                    max={room}
                    exclude={[...team.members, ...team.invites].map((member) => member.user._id)}
                />
            </Modal>

            <ConfirmDialog
                open={Boolean(removing)}
                onClose={() => setRemoving(null)}
                onConfirm={remove}
                title={removing?.status === "INVITED" ? "Withdraw this invite?" : `Remove ${removing?.user.name} from the team?`}
                description={
                    removing?.status === "INVITED"
                        ? "They won't be able to join with this invite."
                        : "Their registration through the team is cancelled and they're notified."
                }
                confirmLabel={removing?.status === "INVITED" ? "Withdraw invite" : "Remove"}
                variant="danger"
            />
        </div>
    );
};

/** Invites the viewer has for this event, with accept / decline. */
export const TeamInvites = ({ event, invites, onChange }) => {
    const toast = useToast();
    const [busy, setBusy] = useState(null);

    const [answering, setAnswering] = useState(null);
    const { attempt, dialog: clashDialog } = useClashSwitch({ eventTitle: event.title, full: event.registrationState === "FULL" });
    const memberQuestions = formQuestions(event, "MEMBER").member;
    const respond = async (invite, accept, body) => {
        if (accept && memberQuestions.length && !body) {
            setAnswering(invite);
            return false;
        }
        setBusy(`${invite.team._id}-${accept}`);
        try {
            // Busy at the same time? Ask to switch, then accept again giving that place up.
            const response = accept
                ? await attempt((extra) => {
                      const payload = { ...(body || {}), ...extra };
                      return Object.keys(payload).length
                          ? eventApi.acceptTeamInvite(event._id, invite.team._id, payload)
                          : eventApi.acceptTeamInvite(event._id, invite.team._id);
                  })
                : await eventApi.declineTeamInvite(event._id, invite.team._id);
            if (!response) return false;
            if (accept && response.data?.waitlisted) {
                toast.info(`${response.message}${switchedText(response)}`);
            } else {
                toast.success(`${response.message}${switchedText(response)}`);
            }
            onChange();
        } catch (error) {
            toast.error(error);
            onChange();
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="stack-sm">
            {invites.map((invite) => (
                <div key={invite.team._id} className="team-invite">
                    <span className="team-badge" aria-hidden="true">
                        <MailPlus size={17} />
                    </span>
                    <div className="grow">
                        <strong>
                            {invite.team.leader?.name} invited you to join "{invite.team.name}"
                        </strong>
                        <span className="subtle small">
                            {invite.team.size} member{invite.team.size === 1 ? "" : "s"} so far · invited {timeAgo(invite.invitedAt)}
                        </span>
                    </div>
                    <div className="team-invite-actions">
                        <Button size="sm" onClick={() => respond(invite, true)} loading={busy === `${invite.team._id}-true`} disabled={Boolean(busy)}>
                            Accept
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => respond(invite, false)}
                            loading={busy === `${invite.team._id}-false`}
                            disabled={Boolean(busy)}
                        >
                            Decline
                        </Button>
                    </div>
                </div>
            ))}
            {clashDialog}
            <RegistrationFormDialog
                open={Boolean(answering)}
                onClose={() => setAnswering(null)}
                event={event}
                role="MEMBER"
                title={answering ? `Join "${answering.team.name}"` : ""}
                onSubmit={async (body) => {
                    const invite = answering;
                    return respond(invite, true, body);
                }}
            />
        </div>
    );
};
