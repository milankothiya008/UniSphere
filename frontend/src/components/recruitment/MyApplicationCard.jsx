import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Check, ChevronDown, Clock, Gift, Hourglass, Info, MapPin, PartyPopper, PencilLine, Send, Undo2, Video, X } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Alert, Badge, ButtonLink, Button, ConfirmDialog } from "../ui";
import { ApplicationBadge } from "./RecruitmentParts";
import { ROUND_MODES } from "../../lib/constants";
import { countdownParts, dateParts, formatDate, formatDateTime, formatTimeRange, timeAgo } from "../../lib/format";

// A calendar file for one interview, so students can add it to their phone's calendar.
const icsFor = (drive, round) => {
    const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const where = round.mode === "ONLINE" ? round.meetingLink || "Online" : [round.venue?.name, round.venue?.location].filter(Boolean).join(", ");
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CampusConnect//Recruitment//EN",
        "BEGIN:VEVENT",
        `UID:${round._id}-${drive._id}@campusconnect`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(round.slot.startAt)}`,
        `DTEND:${stamp(round.slot.endAt)}`,
        `SUMMARY:${round.name} (${round.positionTitle}) — ${drive.club.name}`,
        `LOCATION:${where}`,
        `DESCRIPTION:${(round.instructions || drive.title).replace(/\n/g, "\\n")}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT60M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Interview in 1 hour",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
    ];
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
};

const RESULT_ICON = { QUALIFIED: Check, ELIMINATED: X };

const InterviewCard = ({ drive, round }) => {
    const soon = new Date(round.slot.startAt) - Date.now() < 86400000;
    return (
        <div className={`recruit-interview ${soon ? "is-soon" : ""}`}>
            <div className="recruit-interview-date">
                <span>{dateParts(round.slot.startAt).month}</span>
                <strong>{dateParts(round.slot.startAt).day}</strong>
            </div>
            <div className="grow stack-sm">
                <strong>{round.name}</strong>
                <span className="row small" style={{ gap: 6 }}>
                    <Clock size={14} /> {formatDate(round.slot.startAt)} · {formatTimeRange(round.slot.startAt, round.slot.endAt)}
                </span>
                {round.mode === "OFFLINE" && round.venue && (
                    <span className="row small" style={{ gap: 6 }}>
                        <MapPin size={14} /> {round.venue.name}
                        {round.venue.location ? `, ${round.venue.location}` : ""}
                    </span>
                )}
                {round.instructions && <p className="small muted pre-line" style={{ margin: 0 }}>{round.instructions}</p>}
                <div className="row" style={{ gap: 8 }}>
                    {round.mode === "ONLINE" && round.meetingLink && (
                        <a className="btn btn-primary btn-sm" href={round.meetingLink} target="_blank" rel="noreferrer">
                            <Video size={15} /> Join meeting
                        </a>
                    )}
                    <a className="btn btn-secondary btn-sm" href={icsFor(drive, round)} download={`${round.name}.ics`}>
                        <CalendarPlus size={15} /> Add to calendar
                    </a>
                </div>
                <span className="subtle small">We'll remind you 1 hour and 10 minutes before.</span>
            </div>
        </div>
    );
};

// Ticks every 30 seconds so an offer's countdown stays current.
const useNow = () => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    return now;
};

const OPEN = ["APPLIED", "IN_ROUNDS", "OFFERED", "RESERVE"];

/** An offer to join in this role: accept (closing every other application) or decline, before the deadline. */
const OfferPanel = ({ drive, application, others, onChange }) => {
    const toast = useToast();
    const [dialog, setDialog] = useState(null);
    const now = useNow();
    const left = new Date(application.offerExpiresAt) - now;
    const closing = others.filter((other) => OPEN.includes(other.status));
    const closingTitles = closing.map((other) => other.positionTitle).join(", ");
    const applicationWord = closing.length === 1 ? "application" : "applications";

    const respond = async (accept) => {
        const response = accept ? await recruitmentApi.acceptOffer(drive._id, application._id) : await recruitmentApi.declineOffer(drive._id, application._id);
        toast.success(response.message);
        onChange();
    };

    return (
        <div className="recruit-offer" id={`offer-${application._id}`}>
            <div className="recruit-offer-head">
                <span className="recruit-offer-icon">
                    <Gift size={22} />
                </span>
                <div>
                    <strong>You've been offered {application.positionTitle}!</strong>
                    <span>{drive.club.name} would love you to join the team.</span>
                </div>
            </div>
            <div className={`recruit-offer-clock ${left < 86400000 ? "is-urgent" : ""}`}>
                <Hourglass size={15} />
                {left > 0 ? (
                    <span>
                        Answer within <strong>{countdownParts(left).map(([value, unit]) => `${value} ${unit}`).join(" ")}</strong> · by {formatDateTime(application.offerExpiresAt)}
                    </span>
                ) : (
                    <span>The deadline has passed</span>
                )}
            </div>
            {closing.length > 0 && (
                <p className="small recruit-offer-note">
                    <Info size={14} /> You can hold one role. Accepting closes your {closingTitles} {applicationWord}.
                </p>
            )}
            <div className="recruit-offer-actions">
                <Button variant="success" onClick={() => setDialog("accept")} disabled={left <= 0}>
                    <Check size={16} /> Accept offer
                </Button>
                <Button variant="ghost" onClick={() => setDialog("decline")} disabled={left <= 0}>
                    <X size={16} /> Decline
                </Button>
            </div>
            <ConfirmDialog
                open={dialog === "accept"}
                onClose={() => setDialog(null)}
                onConfirm={() => respond(true)}
                title={`Join ${drive.club.name} as ${application.positionTitle}?`}
                description={
                    closing.length
                        ? `You'll become a member right away, and your other ${applicationWord} (${closingTitles}) will be closed. This can't be undone.`
                        : "You'll become a member of the club right away."
                }
                confirmLabel="Accept and join"
                variant="success"
            />
            <ConfirmDialog
                open={dialog === "decline"}
                onClose={() => setDialog(null)}
                onConfirm={() => respond(false)}
                title={`Decline the ${application.positionTitle} offer?`}
                description="The seat goes to the next candidate. Your other applications stay open."
                confirmLabel="Decline offer"
                variant="danger"
            />
        </div>
    );
};

// [alert type, title, text] for applications that have reached an end.
const OUTCOME_NOTES = {
    RESERVE: ["info", "You're on the reserve list", "The seats have been offered for now. If one frees up, you'll get an offer by email."],
    DECLINED: ["info", "You declined this offer", null],
    EXPIRED: ["warning", "This offer expired", "The deadline passed without an answer. Contact the club if you think this is a mistake."],
    ELIMINATED: ["info", "Thank you for applying", "You weren't shortlisted this time. Keep building your skills — and apply again when the club recruits next."],
    NOT_SELECTED: ["info", "Thank you for applying", "The club couldn't offer you this role this time. Keep building your skills — and apply again when the club recruits next."]
};

const STATUS_ICON = { OFFERED: Gift, ACCEPTED: PartyPopper, APPLIED: Send, IN_ROUNDS: Clock, RESERVE: Hourglass };

// One line under the role name: what's happening with this application right now.
const summaryOf = (application, upcoming, closedForMe) => {
    if (closedForMe) return application.closedReason;
    if (application.status === "OFFERED") return `Offer — answer by ${formatDateTime(application.offerExpiresAt)}`;
    if (application.status === "ACCEPTED") return "You're in the team";
    if (upcoming[0]) return `${upcoming[0].name} · ${formatDateTime(upcoming[0].slot.startAt)}`;
    const cleared = application.rounds.filter((round) => round.result === "QUALIFIED").length;
    if (application.status === "IN_ROUNDS") return cleared ? `Cleared ${cleared} ${cleared === 1 ? "round" : "rounds"} — next step soon` : "In selection";
    if (application.status === "APPLIED") return `Applied ${timeAgo(application.createdAt)}`;
    return OUTCOME_NOTES[application.status]?.[1] || "";
};

/**
 * One of the student's applications on the drive page. The header says where it stands; it opens to show
 * the offer, interviews and round timeline. Applications that need the student open by themselves.
 */
export const MyApplicationCard = ({ drive, application, others = [], onChange, defaultOpen }) => {
    const toast = useToast();
    const navigate = useNavigate();
    const [confirm, setConfirm] = useState(false);

    const rounds = application.rounds.map((round) => ({ ...round, positionTitle: application.positionTitle }));
    const upcoming = rounds.filter((round) => round.slot && !round.result && new Date(round.slot.endAt) > new Date());
    const decided = !["APPLIED", "IN_ROUNDS"].includes(application.status);
    const closedForMe = application.status === "WITHDRAWN" && application.closedReason;
    const note = closedForMe ? ["info", "Application closed", `${application.closedReason} — a student holds one role in a club, so this application was closed.`] : OUTCOME_NOTES[application.status];
    const needsYou = application.status === "OFFERED" || upcoming.length > 0;
    const [open, setOpen] = useState(defaultOpen ?? needsYou);
    const Icon = closedForMe ? X : STATUS_ICON[application.status] || Check;

    const withdraw = async () => {
        await recruitmentApi.withdraw(drive._id, application.position);
        toast.success(`${application.positionTitle} application withdrawn`);
        onChange();
    };

    return (
        <section className={`recruit-app-card is-${application.status.toLowerCase()} ${closedForMe ? "is-closed" : ""} ${open ? "is-open" : ""}`}>
            <div className="recruit-app-card-head">
                <button type="button" className="recruit-app-card-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                    <span className="recruit-app-card-icon">
                        <Icon size={17} />
                    </span>
                    <span className="recruit-app-card-text">
                        <span className="recruit-app-card-kicker">Your application</span>
                        <strong>{application.positionTitle}</strong>
                        <span className="subtle small">{summaryOf(application, upcoming, closedForMe)}</span>
                    </span>
                    {closedForMe ? <Badge dot>Closed</Badge> : <ApplicationBadge status={application.status} />}
                    <ChevronDown size={18} className="recruit-chevron" aria-hidden="true" />
                </button>
                <ActionMenu
                    label={`${application.positionTitle} application actions`}
                    items={[
                        { label: "Edit answers", icon: PencilLine, onClick: () => navigate(`/recruitment/${drive._id}/apply/${application.position}`), hidden: !application.canEdit },
                        { label: "Withdraw application", icon: Undo2, onClick: () => setConfirm(true), hidden: !application.canWithdraw, danger: true }
                    ]}
                />
            </div>
            <div className="recruit-collapse" inert={!open}>
                <div className="recruit-collapse-inner">
                    <div className="stack recruit-app-card-body">
                        {application.status === "OFFERED" && <OfferPanel drive={drive} application={application} others={others} onChange={onChange} />}
                        {application.status === "ACCEPTED" && (
                            <div className="recruit-celebrate">
                                <PartyPopper size={26} />
                                <div>
                                    <strong>Welcome to {drive.club.name}!</strong>
                                    <span>You've joined as {application.positionTitle}.</span>
                                </div>
                                <ButtonLink to={`/clubs/${drive.club._id}`} size="sm" variant="secondary">
                                    Open club
                                </ButtonLink>
                            </div>
                        )}
                        {note && application.status !== "DECLINED" && (
                            <Alert type={note[0]} title={note[1]}>
                                {note[2]}
                            </Alert>
                        )}

                        {upcoming.map((round) => (
                            <InterviewCard key={round._id} drive={drive} round={round} />
                        ))}

                        <ol className="recruit-timeline">
                            <li className="is-done">
                                <span className="recruit-timeline-dot">
                                    <Check size={12} strokeWidth={3} />
                                </span>
                                <div>
                                    <strong>Applied</strong>
                                    <span className="subtle small">{timeAgo(application.createdAt)}</span>
                                </div>
                            </li>
                            {rounds.map((round) => {
                                const ResultIcon = RESULT_ICON[round.result];
                                return (
                                    <li key={round._id} className={round.result === "QUALIFIED" ? "is-done" : round.result === "ELIMINATED" ? "is-out" : "is-current"}>
                                        <span className="recruit-timeline-dot">{ResultIcon ? <ResultIcon size={12} strokeWidth={3} /> : null}</span>
                                        <div>
                                            <strong>{round.name}</strong>
                                            <span className="subtle small">
                                                {ROUND_MODES[round.mode]?.label}
                                                {round.result === "QUALIFIED" ? " · Cleared" : round.result === "ELIMINATED" ? " · Not shortlisted" : round.slot ? ` · ${formatDateTime(round.slot.startAt)}` : " · In review"}
                                            </span>
                                        </div>
                                    </li>
                                );
                            })}
                            {!decided && (
                                <li className="is-next">
                                    <span className="recruit-timeline-dot" />
                                    <div>
                                        <strong>Final selection</strong>
                                        <span className="subtle small">You'll get an email for every step.</span>
                                    </div>
                                </li>
                            )}
                        </ol>
                    </div>
                </div>
            </div>
            <ConfirmDialog
                open={confirm}
                onClose={() => setConfirm(false)}
                onConfirm={withdraw}
                title={`Withdraw your ${application.positionTitle} application?`}
                description="The club will no longer consider you for this role. Your other applications aren't affected, and while applications are open you can apply again."
                confirmLabel="Withdraw"
                variant="danger"
            />
        </section>
    );
};
