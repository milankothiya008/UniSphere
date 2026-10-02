import { useEffect, useState } from "react";
import { Award, BellRing, CalendarClock, Cpu, Download, FileBadge, Gavel, MessageSquareHeart, Star, Users } from "lucide-react";
import { certificateApi, eventApi, hackathonApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, ButtonLink, Card, Modal, Segmented, Switch, Textarea } from "../ui";
import { formatDate, formatDateTime, timeAgo } from "../../lib/format";

const ended = (event) => new Date(event.endAt) <= new Date();

// ---------------------------------------------------------------- Hackathon summary

const PHASES = {
    UPCOMING: "Starts soon",
    SELECTION: "Choosing problems",
    REPOSITORY: "Building · repo due",
    FINAL: "Final submissions",
    JUDGING: "Judging",
    CANCELLED: "Cancelled"
};

/** On a hackathon's event page: where it stands, the key deadlines, and a way into the hub. */
export const HackathonSummary = ({ event }) => {
    const { data } = useApi(() => hackathonApi.get(event._id), [event._id], { enabled: event.category === "HACKATHON" && Boolean(event.viewer) });
    if (event.category !== "HACKATHON" || !data) return null;
    const viewer = data.viewer;
    const steps = [
        ["Problem statements out", data.revealAt],
        ["Choose a problem by", data.selectionDeadline],
        ["Add your code repository by", data.repoDeadline],
        ["Final submission by", data.submissionDeadline]
    ];
    const cta = viewer.canManage ? "Manage hackathon" : viewer.canJudge ? "Open judging panel" : viewer.isParticipant ? "Open your team's hub" : "Hackathon details";
    return (
        <Card
            className="hack-summary"
            title={
                <h2 className="row">
                    <Cpu size={18} /> Hackathon
                </h2>
            }
            actions={<span className={`hack-phase is-${data.phase.toLowerCase()}`}>{PHASES[data.phase]}</span>}
        >
            <div className="stack">
                <ol className="hack-steps">
                    {steps.map(([label, at]) => (
                        <li key={label} className={new Date(at) <= new Date() ? "is-done" : ""}>
                            <span className="hack-step-dot" />
                            <span>
                                <strong>{label}</strong>
                                <span className="subtle small">{formatDateTime(at)}</span>
                            </span>
                        </li>
                    ))}
                </ol>
                <div className="hack-facts">
                    <span>
                        <FileBadge size={14} /> {data.problemCount} problem statement{data.problemCount === 1 ? "" : "s"}
                    </span>
                    <span>
                        <Gavel size={14} /> {data.judgeCount} judge{data.judgeCount === 1 ? "" : "s"}
                    </span>
                    {data.agenda.length > 0 && (
                        <span>
                            <CalendarClock size={14} /> {data.agenda.length}-item agenda
                        </span>
                    )}
                </div>
                {viewer.isParticipant && data.myEntry && (
                    <p className="small" style={{ margin: 0 }}>
                        <strong>{data.myEntry.name}:</strong>{" "}
                        {data.myEntry.submittedAt
                            ? `submitted “${data.myEntry.project?.title}”`
                            : data.myEntry.repoSubmittedAt
                              ? `repository added · final submission ${new Date(data.repoDeadline) <= new Date() ? "open now" : `opens ${formatDateTime(data.repoDeadline)}`}`
                              : data.myEntry.problemStatement
                                ? `working on “${data.myEntry.problemStatement.title}” · repository due ${formatDateTime(data.repoDeadline)}`
                                : "no problem chosen yet"}
                    </p>
                )}
                <ButtonLink to={`/events/${event._id}/hackathon${viewer.canJudge && !viewer.canManage ? "?tab=judging" : ""}`} variant={viewer.isParticipant || viewer.canManage || viewer.canJudge ? "primary" : "secondary"} block>
                    <Cpu size={16} /> {cta}
                </ButtonLink>
            </div>
        </Card>
    );
};

// ---------------------------------------------------------------- Certificates

/** Organisers switch certificates on; students download theirs once the event is over. */
export const CertificatesCard = ({ event, onChange }) => {
    const toast = useToast();
    const viewer = event.viewer || {};
    const isOver = ended(event) || event.status === "COMPLETED";
    const { data } = useApi(() => eventApi.certificates(event._id), [event._id, event.certificatesEnabled, event.status], {
        enabled: Boolean(event.viewer) && event.certificatesEnabled && isOver
    });
    const [saving, setSaving] = useState(false);
    const [downloading, setDownloading] = useState(null);
    const items = data?.items || [];
    const canToggle = viewer.canManage && !["CANCELLED", "REJECTED"].includes(event.status);

    if (!canToggle && !items.length) return null;

    const toggle = async (on) => {
        setSaving(true);
        try {
            const response = await eventApi.update(event._id, { certificatesEnabled: on });
            onChange(response.data);
            toast.success(on ? "Certificates switched on" : "Certificates switched off");
        } catch (error) {
            toast.error(error);
        } finally {
            setSaving(false);
        }
    };

    const download = async (item) => {
        setDownloading(item.code);
        try {
            await certificateApi.download(item.code);
        } catch (error) {
            toast.error(error);
        } finally {
            setDownloading(null);
        }
    };

    return (
        <Card
            title={
                <h2 className="row" id="certificates">
                    <Award size={18} color="var(--gold-600)" /> Certificates
                </h2>
            }
        >
            <div className="stack">
                {canToggle && (
                    <Switch
                        checked={Boolean(event.certificatesEnabled)}
                        onChange={toggle}
                        disabled={saving}
                        label="Give certificates for this event"
                        description="Participation for students checked in at the event; merit for winners once results are published."
                    />
                )}
                {items.map((item) => (
                    <div key={item.code} className={`cert-row ${item.kind === "MERIT" ? "is-merit" : ""}`}>
                        <span className="cert-icon">
                            <Award size={20} />
                        </span>
                        <span className="cert-body">
                            <strong>{item.kind === "MERIT" ? `Certificate of Merit — ${item.awardTitle}` : "Certificate of Participation"}</strong>
                            <span className="subtle small">
                                {item.teamName ? `Team ${item.teamName} · ` : ""}ID {item.code}
                            </span>
                        </span>
                        <Button size="sm" onClick={() => download(item)} loading={downloading === item.code}>
                            <Download size={15} /> PDF
                        </Button>
                    </div>
                ))}
            </div>
        </Card>
    );
};

// ---------------------------------------------------------------- Feedback

const Stars = ({ value, onChange, size = 28, label = "Rating" }) => (
    <div className="stars" role={onChange ? "radiogroup" : "img"} aria-label={onChange ? label : `${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) =>
            onChange ? (
                <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} className={`star ${n <= value ? "is-on" : ""}`} onClick={() => onChange(n)}>
                    <Star size={size} />
                </button>
            ) : (
                <span key={n} className={`star ${n <= Math.round(value) ? "is-on" : ""}`} aria-hidden="true">
                    <Star size={size} />
                </span>
            )
        )}
    </div>
);

const RATING_WORDS = ["", "Poor", "Okay", "Good", "Very good", "Excellent"];

/** After an event: attendees rate it with stars and a note; organisers and the mentor see the summary. */
export const FeedbackCard = ({ event }) => {
    const toast = useToast();
    const show = Boolean(event.viewer) && ["PUBLISHED", "COMPLETED"].includes(event.status) && ended(event);
    const { data, setData } = useApi(() => eventApi.feedback(event._id), [event._id], { enabled: show });
    const [rating, setRating] = useState(0);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (data?.mine) {
            setRating(data.mine.rating);
            setNote(data.mine.note || "");
        }
    }, [data?.mine]);

    if (!show || !data || (!data.canGive && !data.mine && !data.summary)) return null;

    const save = async () => {
        setSaving(true);
        try {
            const response = await eventApi.giveFeedback(event._id, { rating, note });
            setData(response.data);
            setEditing(false);
            toast.success("Thanks — your feedback helps the club");
        } catch (error) {
            toast.error(error);
        } finally {
            setSaving(false);
        }
    };

    const summary = data.summary;
    const asking = data.canGive && (!data.mine || editing);

    return (
        <Card
            title={
                <h2 className="row" id="feedback">
                    <MessageSquareHeart size={18} /> Feedback
                </h2>
            }
        >
            <div className="stack">
                {asking && (
                    <div className="feedback-form">
                        <strong>How was {event.title}?</strong>
                        <Stars value={rating} onChange={setRating} />
                        {rating > 0 && <span className="subtle small">{RATING_WORDS[rating]}</span>}
                        <Textarea label="Anything the club should keep or change? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} />
                        <span className="subtle small">Your name isn't shown to the club. You can change your answer until {formatDate(data.closesAt)}.</span>
                        <div className="row">
                            <Button onClick={save} loading={saving} disabled={!rating}>
                                Send feedback
                            </Button>
                            {editing && (
                                <Button variant="ghost" onClick={() => setEditing(false)}>
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </div>
                )}
                {data.mine && !asking && (
                    <div className="feedback-mine">
                        <Stars value={data.mine.rating} size={18} />
                        <span className="small">You rated it {RATING_WORDS[data.mine.rating].toLowerCase()}</span>
                        {data.canGive && (
                            <button type="button" className="link-button" onClick={() => setEditing(true)}>
                                Edit
                            </button>
                        )}
                    </div>
                )}
                {summary && (
                    <div className="feedback-summary">
                        {summary.count ? (
                            <>
                                <div className="feedback-score">
                                    <strong>{summary.average.toFixed(1)}</strong>
                                    <Stars value={summary.average} size={16} />
                                    <span className="subtle small">
                                        {summary.count} of {summary.attendees} attendee{summary.attendees === 1 ? "" : "s"} rated it
                                    </span>
                                </div>
                                <div className="feedback-bars" aria-label="Ratings">
                                    {[5, 4, 3, 2, 1].map((stars) => {
                                        const count = summary.distribution[stars - 1];
                                        return (
                                            <div key={stars} className="feedback-bar">
                                                <span className="small">{stars}★</span>
                                                <span className="feedback-bar-track">
                                                    <span style={{ width: `${summary.count ? (count / summary.count) * 100 : 0}%` }} />
                                                </span>
                                                <span className="small subtle">{count}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                {summary.notes.length > 0 && (
                                    <ul className="feedback-notes">
                                        {summary.notes.map((item, index) => (
                                            <li key={index}>
                                                <Stars value={item.rating} size={12} />
                                                <p>{item.note}</p>
                                                <span className="subtle small">{timeAgo(item.at)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </>
                        ) : (
                            <p className="subtle" style={{ margin: 0 }}>
                                No ratings yet. Attendees were asked when the event ended and can answer until {formatDate(data.closesAt)}.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
};

// ---------------------------------------------------------------- Reminders

const KINDS = [
    { value: "REGISTRATION_CLOSING", label: "Registration closing", to: "Eligible students who haven't registered" },
    { value: "EVENT_STARTING", label: "Event starting", to: "Everyone registered" }
];

/** The "Send reminder" dialog for roles with the reminder authority. */
export const ReminderDialog = ({ event, open, onClose, onSent }) => {
    const toast = useToast();
    const status = event.viewer?.reminders;
    const firstAvailable = KINDS.find((kind) => status?.[kind.value]?.available)?.value || KINDS[0].value;
    const [kind, setKind] = useState(firstAvailable);
    const [note, setNote] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setKind(firstAvailable);
            setNote("");
            setError(null);
        }
    }, [open, firstAvailable]);

    if (!status) return null;
    const current = status[kind];
    const chosen = KINDS.find((item) => item.value === kind);

    const send = async () => {
        setPending(true);
        setError(null);
        try {
            const response = await eventApi.sendReminder(event._id, kind, note.trim() || undefined);
            toast.success(response.message);
            onSent?.();
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title="Send a reminder"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button onClick={send} loading={pending} disabled={!current?.available}>
                        <BellRing size={16} /> Send reminder
                    </Button>
                </>
            }
        >
            <div className="stack">
                <Segmented label="Reminder" value={kind} onChange={setKind} options={KINDS.map((item) => ({ value: item.value, label: item.label }))} />
                <div className="reminder-to">
                    <Users size={16} />
                    <span>
                        <strong>To:</strong> {chosen.to}. They get an in-app notification and an email{kind === "REGISTRATION_CLOSING" ? " with the deadline and seats left" : " with the time, venue and their ticket"}.
                    </span>
                </div>
                {current?.lastSentAt && (
                    <p className="subtle small" style={{ margin: 0 }}>
                        Last sent {timeAgo(current.lastSentAt)}
                        {typeof current.lastRecipients === "number" ? ` to ${current.lastRecipients} student${current.lastRecipients === 1 ? "" : "s"}` : ""}.
                    </p>
                )}
                {!current?.available && current?.reason && <p className="small" style={{ margin: 0, color: "var(--warning-600)" }}>{current.reason}</p>}
                <Textarea label="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder={kind === "REGISTRATION_CLOSING" ? "e.g. Only 10 seats left — bring a friend!" : "e.g. Reach 15 minutes early for check-in."} />
                <p className="subtle small" style={{ margin: 0 }}>
                    Registered students are also reminded automatically a day before and an hour before the start.
                </p>
                <ApiErrorAlert error={error} />
            </div>
        </Modal>
    );
};
