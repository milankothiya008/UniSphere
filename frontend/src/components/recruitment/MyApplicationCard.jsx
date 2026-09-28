import { useState } from "react";
import { CalendarPlus, Check, Clock, MapPin, PartyPopper, PencilLine, Undo2, Video, X } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { Alert, ButtonLink, Button, Card, ConfirmDialog, Skeleton } from "../ui";
import { ApplicationBadge, roleName } from "./RecruitmentParts";
import { ROUND_MODES } from "../../lib/constants";
import { dateParts, formatDate, formatDateTime, formatTimeRange, timeAgo } from "../../lib/format";

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
        `SUMMARY:${round.name} — ${drive.club.name}`,
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

/** The student's own application on the drive page: status, round-by-round timeline and interviews. */
export const MyApplicationCard = ({ drive, onChange }) => {
    const toast = useToast();
    const { data: application, loading, reload } = useApi(() => recruitmentApi.myApplication(drive._id), [drive._id]);
    const [confirm, setConfirm] = useState(false);

    if (loading && !application) {
        return <Skeleton height={180} style={{ borderRadius: 16 }} />;
    }
    if (!application) {
        return null;
    }

    const withdraw = async () => {
        await recruitmentApi.withdraw(drive._id);
        toast.success("Application withdrawn");
        onChange();
    };

    const finished = ["SELECTED", "ELIMINATED", "NOT_SELECTED"].includes(application.status);
    const upcoming = application.rounds.filter((round) => round.slot && !round.result && new Date(round.slot.endAt) > new Date());

    return (
        <Card
            className={`recruit-mine is-${application.status.toLowerCase()}`}
            title={<h2 className="row">Your application</h2>}
            actions={<ApplicationBadge status={application.status} />}
        >
            <div className="stack">
                {application.status === "SELECTED" && (
                    <div className="recruit-celebrate">
                        <PartyPopper size={26} />
                        <div>
                            <strong>Welcome to {drive.club.name}!</strong>
                            <span>You've been selected as {roleName(application.finalRole)}.</span>
                        </div>
                        <ButtonLink to={`/clubs/${drive.club._id}`} size="sm" variant="secondary">
                            Open club
                        </ButtonLink>
                    </div>
                )}
                {["ELIMINATED", "NOT_SELECTED"].includes(application.status) && (
                    <Alert type="info" title="Thank you for applying">
                        The club didn't select you this time. Keep building your skills — and apply again when {drive.club.name} recruits next.
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
                            <span className="subtle small">
                                {application.positionTitles.join(", ")} · {timeAgo(application.createdAt)}
                            </span>
                        </div>
                    </li>
                    {application.rounds.map((round) => {
                        const Icon = RESULT_ICON[round.result];
                        return (
                            <li key={round._id} className={round.result === "QUALIFIED" ? "is-done" : round.result === "ELIMINATED" ? "is-out" : "is-current"}>
                                <span className="recruit-timeline-dot">{Icon ? <Icon size={12} strokeWidth={3} /> : null}</span>
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
                    {!finished && (
                        <li className="is-next">
                            <span className="recruit-timeline-dot" />
                            <div>
                                <strong>Final decision</strong>
                                <span className="subtle small">You'll get an email for every step.</span>
                            </div>
                        </li>
                    )}
                </ol>

                {(application.canEdit || application.canWithdraw) && (
                    <div className="row" style={{ gap: 8 }}>
                        {application.canEdit && (
                            <ButtonLink to={`/recruitment/${drive._id}/apply`} variant="secondary" size="sm">
                                <PencilLine size={15} /> Edit answers
                            </ButtonLink>
                        )}
                        {application.canWithdraw && (
                            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                                <Undo2 size={15} /> Withdraw
                            </Button>
                        )}
                    </div>
                )}
            </div>
            <ConfirmDialog
                open={confirm}
                onClose={() => setConfirm(false)}
                onConfirm={async () => {
                    await withdraw();
                    reload({ silent: true });
                }}
                title="Withdraw your application?"
                description="The club will no longer consider you for this drive. While applications are open you can apply again."
                confirmLabel="Withdraw"
                variant="danger"
            />
        </Card>
    );
};
