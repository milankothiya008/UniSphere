import { useEffect, useMemo, useState } from "react";
import { Award, CalendarClock, Check, ClipboardList, Flag, MapPin, MonitorPlay, Plus, Send, Users, Video, X } from "lucide-react";
import { recruitmentApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Modal, Segmented, Select, Textarea } from "../ui";
import { roleName } from "./RecruitmentParts";
import { ROUND_MODES } from "../../lib/constants";
import { formatDate, formatDateTime, formatTime, formatTimeRange, fromDateTimeInput, plural, toDateTimeInput } from "../../lib/format";

const MODE_ICONS = { SCREENING: ClipboardList, ONLINE: MonitorPlay, OFFLINE: MapPin };
const ROUND_STATUS = { DRAFT: ["Not scheduled", "neutral"], SCHEDULED: ["Scheduled", "info"], RESULTS_PUBLISHED: ["Results published", "success"] };

const addMinutes = (input, minutes) => (input ? toDateTimeInput(new Date(new Date(fromDateTimeInput(input)).getTime() + minutes * 60000)) : "");

// ---------------------------------------------------------------- Add a round

const AddRound = ({ driveId, number, onDone }) => {
    const toast = useToast();
    const [name, setName] = useState("");
    const [mode, setMode] = useState("SCREENING");
    const [busy, setBusy] = useState(false);
    const suggestions = { SCREENING: "Application screening", ONLINE: "Online interview", OFFLINE: "Interview" };

    const create = async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
            await recruitmentApi.createRound(driveId, { name: name.trim() || suggestions[mode], mode });
            toast.success(`Round ${number} added`);
            setName("");
            onDone();
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title={<h2 className="row"><Plus size={18} /> Add round {number}</h2>} className="recruit-add-round">
            <form className="stack" onSubmit={create}>
                <div className="recruit-mode-picker" role="radiogroup" aria-label="Round type">
                    {Object.entries(ROUND_MODES).map(([value, info]) => {
                        const Icon = MODE_ICONS[value];
                        return (
                            <button key={value} type="button" role="radio" aria-checked={mode === value} className={`recruit-mode ${mode === value ? "is-on" : ""}`} onClick={() => setMode(value)}>
                                <Icon size={20} />
                                <strong>{info.label}</strong>
                                <span>{info.hint}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
                    <Input className="grow" label="Round name" value={name} onChange={(event) => setName(event.target.value)} placeholder={suggestions[mode]} maxLength={80} />
                    <Button type="submit" loading={busy}>
                        <Plus size={16} /> Add round
                    </Button>
                </div>
            </form>
        </Card>
    );
};

// ---------------------------------------------------------------- Schedule an interview round

const ScheduleForm = ({ driveId, round, candidates, onDone, onCancel }) => {
    const toast = useToast();
    const [timing, setTiming] = useState(round.timing || "SLOTS");
    const [startAt, setStartAt] = useState(round.startAt ? toDateTimeInput(round.startAt) : "");
    const [endAt, setEndAt] = useState(round.endAt && round.timing === "COMMON" ? toDateTimeInput(round.endAt) : "");
    const [slotMinutes, setSlotMinutes] = useState(round.slotMinutes || 15);
    const [venue, setVenue] = useState(round.venue?._id || round.venue || "");
    const [meetingLink, setMeetingLink] = useState(round.meetingLink || "");
    const [instructions, setInstructions] = useState(round.instructions || "");
    const [venues, setVenues] = useState([]);
    const [busy, setBusy] = useState(false);

    const computedEnd = timing === "SLOTS" ? addMinutes(startAt, candidates * Number(slotMinutes || 0)) : endAt;

    // Which venues are free for the whole round.
    useEffect(() => {
        if (round.mode !== "OFFLINE") {
            return undefined;
        }
        let active = true;
        const ready = startAt && computedEnd && computedEnd > startAt && computedEnd.slice(0, 10) === startAt.slice(0, 10);
        const request = ready
            ? referenceApi.availableVenues({ eventDate: startAt.slice(0, 10), startTime: startAt.slice(11, 16), endTime: computedEnd.slice(11, 16) })
            : referenceApi.venues({ status: "ACTIVE" });
        request.then((response) => active && setVenues(response.data)).catch(() => {});
        return () => {
            active = false;
        };
    }, [round.mode, startAt, computedEnd]);

    const submit = async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
            await recruitmentApi.scheduleRound(driveId, round._id, {
                timing,
                startAt: fromDateTimeInput(startAt),
                endAt: timing === "COMMON" ? fromDateTimeInput(endAt) : undefined,
                slotMinutes: timing === "SLOTS" ? Number(slotMinutes) : undefined,
                venue: round.mode === "OFFLINE" ? venue : undefined,
                meetingLink: round.mode === "ONLINE" ? meetingLink.trim() : undefined,
                instructions
            });
            toast.success(round.status === "SCHEDULED" ? "Updated — candidates have been told the new details" : "Scheduled — invitations are on their way");
            onDone();
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="recruit-schedule stack" onSubmit={submit}>
            <Segmented
                label="Timing"
                value={timing}
                onChange={setTiming}
                options={[
                    { value: "SLOTS", label: "Individual slots" },
                    { value: "COMMON", label: "One time for everyone" }
                ]}
            />
            <div className="form-grid">
                <Input label={timing === "SLOTS" ? "First slot starts" : "Starts"} type="datetime-local" value={startAt} min={toDateTimeInput(new Date())} onChange={(event) => setStartAt(event.target.value)} required />
                {timing === "COMMON" ? (
                    <Input label="Ends" type="datetime-local" value={endAt} min={startAt || undefined} onChange={(event) => setEndAt(event.target.value)} required />
                ) : (
                    <Input
                        label="Minutes per candidate"
                        type="number"
                        min={5}
                        max={240}
                        value={slotMinutes}
                        onChange={(event) => setSlotMinutes(event.target.value)}
                        hint={startAt ? `${plural(candidates, "candidate")} · last slot ends ${formatTime(fromDateTimeInput(computedEnd))}` : `${plural(candidates, "candidate")}, back to back`}
                        required
                    />
                )}
                {round.mode === "OFFLINE" ? (
                    <Select
                        className="span-2"
                        label="Venue"
                        value={venue}
                        onChange={(event) => setVenue(event.target.value)}
                        placeholder="Choose a venue"
                        options={venues.map((item) => ({
                            value: item._id,
                            label: `${item.name} · ${item.location}${item.available === false && item._id !== (round.venue?._id || round.venue) ? ` — booked (${item.bookedBy?.[0]?.title || "busy"})` : ""}`,
                            disabled: item.available === false && item._id !== (round.venue?._id || round.venue)
                        }))}
                        required
                    />
                ) : (
                    <Input
                        className="span-2"
                        label="Meeting link"
                        type="url"
                        value={meetingLink}
                        onChange={(event) => setMeetingLink(event.target.value)}
                        placeholder="https://meet.google.com/…"
                        hint="Google Meet, Zoom or Teams — shared with candidates in the invitation"
                        required
                    />
                )}
                <Textarea className="span-2" label="Instructions (optional)" value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} maxLength={1000} placeholder="What to bring or prepare" />
            </div>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                {onCancel && (
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
                <Button type="submit" loading={busy}>
                    <Send size={16} /> {round.status === "SCHEDULED" ? "Update and notify" : "Schedule and invite"}
                </Button>
            </div>
        </form>
    );
};

// ---------------------------------------------------------------- One round

const MoveSlot = ({ driveId, round, candidate, onClose, onDone }) => {
    const toast = useToast();
    const [value, setValue] = useState(toDateTimeInput(candidate.slot.startAt));
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true);
        try {
            await recruitmentApi.moveSlot(driveId, round._id, candidate.applicationId, fromDateTimeInput(value));
            toast.success(`${candidate.applicant.name} has been told the new time`);
            onDone();
            onClose();
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Modal
            open
            onClose={onClose}
            title={`Move ${candidate.applicant.name}'s slot`}
            description={`${round.slotMinutes}-minute slot · currently ${formatDateTime(candidate.slot.startAt)}`}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={save} loading={busy}>
                        Move and notify
                    </Button>
                </>
            }
        >
            <Input label="New start time" type="datetime-local" value={value} min={toDateTimeInput(new Date())} onChange={(event) => setValue(event.target.value)} />
        </Modal>
    );
};

const RoundCard = ({ driveId, round, number, canManage, onChange }) => {
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [moving, setMoving] = useState(null);
    const [pending, setPending] = useState(() => new Set());
    const Icon = MODE_ICONS[round.mode];
    const needsSchedule = round.mode !== "SCREENING";
    const decided = round.candidates.filter((candidate) => candidate.outcome);
    const qualified = round.candidates.filter((candidate) => candidate.outcome === "QUALIFIED").length;
    const published = round.status === "RESULTS_PUBLISHED";
    const canDecide = canManage && round.isCurrent && (!needsSchedule || round.status === "SCHEDULED");
    const [statusLabel, tone] = ROUND_STATUS[round.status];

    const decide = async (candidates, outcome) => {
        const ids = candidates.map((candidate) => candidate.applicationId);
        setPending((current) => new Set([...current, ...ids]));
        try {
            await recruitmentApi.setOutcomes(driveId, round._id, ids.map((applicationId) => ({ applicationId, outcome })));
            onChange();
        } catch (error) {
            toast.error(error);
        } finally {
            setPending((current) => new Set([...current].filter((id) => !ids.includes(id))));
        }
    };

    const publish = async () => {
        const response = await recruitmentApi.publishRound(driveId, round._id);
        toast.success(response.message);
        onChange();
    };

    return (
        <Card
            className={`recruit-round ${round.isCurrent ? "is-current" : ""} ${published ? "is-done" : ""}`}
            title={
                <h2 className="row recruit-round-title">
                    <span className="recruit-round-num">{number}</span>
                    <span className="grow">
                        {round.name}
                        <small>
                            <Icon size={13} /> {ROUND_MODES[round.mode].label}
                        </small>
                    </span>
                </h2>
            }
            actions={<Badge tone={tone} dot>{statusLabel}</Badge>}
        >
            <div className="stack">
                {needsSchedule && round.status === "SCHEDULED" && !editing && (
                    <div className="recruit-round-when">
                        <span className="row" style={{ gap: 6 }}>
                            <CalendarClock size={15} /> {formatDate(round.startAt)} · {formatTimeRange(round.startAt, round.endAt)}
                            {round.timing === "SLOTS" ? ` · ${round.slotMinutes}-min slots` : " · everyone together"}
                        </span>
                        {round.mode === "OFFLINE" && round.venue && (
                            <span className="row" style={{ gap: 6 }}>
                                <MapPin size={15} /> {round.venue.name}, {round.venue.location}
                            </span>
                        )}
                        {round.mode === "ONLINE" && round.meetingLink && (
                            <a className="row" style={{ gap: 6 }} href={round.meetingLink} target="_blank" rel="noreferrer">
                                <Video size={15} /> {round.meetingLink}
                            </a>
                        )}
                        {canManage && round.isCurrent && (
                            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                                Reschedule
                            </Button>
                        )}
                    </div>
                )}
                {needsSchedule && canManage && round.isCurrent && (round.status === "DRAFT" || editing) && (
                    <>
                        {round.status === "DRAFT" && <Alert type="info">Set the time and {round.mode === "OFFLINE" ? "venue" : "meeting link"}. Every candidate gets an invitation, and reminders 1 hour and 10 minutes before.</Alert>}
                        <ScheduleForm driveId={driveId} round={round} candidates={round.candidates.length} onDone={() => { setEditing(false); onChange(); }} onCancel={editing ? () => setEditing(false) : null} />
                    </>
                )}

                {canDecide && round.candidates.length > 0 && (
                    <div className="recruit-decide-bar">
                        <span className="grow small">
                            <strong>{decided.length}</strong> of {round.candidates.length} decided · {qualified} qualifying
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => decide(round.candidates.filter((candidate) => !candidate.outcome), "QUALIFIED")} disabled={decided.length === round.candidates.length}>
                            <Check size={14} /> Qualify the rest
                        </Button>
                        <Button size="sm" onClick={() => setPublishing(true)} disabled={decided.length !== round.candidates.length}>
                            <Send size={14} /> Publish results
                        </Button>
                    </div>
                )}

                <ul className="recruit-candidates">
                    {round.candidates.map((candidate, index) => (
                        <li key={candidate.applicationId} className={`recruit-candidate ${candidate.outcome ? `is-${candidate.outcome.toLowerCase()}` : ""}`} style={{ "--i": Math.min(index, 12) }}>
                            <Avatar name={candidate.applicant.name} size="sm" />
                            <span className="grow">
                                <strong>{candidate.applicant.name}</strong>
                                <span className="subtle small">{candidate.positionTitles.join(", ")}</span>
                            </span>
                            {candidate.slot && round.timing === "SLOTS" && (
                                <button
                                    type="button"
                                    className="recruit-slot"
                                    onClick={() => canManage && round.isCurrent && !published && setMoving(candidate)}
                                    disabled={!canManage || !round.isCurrent || published}
                                    title={canManage && round.isCurrent && !published ? "Move this slot" : undefined}
                                >
                                    {formatTime(candidate.slot.startAt)}
                                </button>
                            )}
                            {canDecide ? (
                                <span className="recruit-outcome" role="group" aria-label={`Result for ${candidate.applicant.name}`}>
                                    <button type="button" className={candidate.outcome === "QUALIFIED" ? "is-on is-yes" : ""} aria-pressed={candidate.outcome === "QUALIFIED"} disabled={pending.has(candidate.applicationId)} onClick={() => decide([candidate], "QUALIFIED")}>
                                        <Check size={14} /> Qualify
                                    </button>
                                    <button type="button" className={candidate.outcome === "ELIMINATED" ? "is-on is-no" : ""} aria-pressed={candidate.outcome === "ELIMINATED"} disabled={pending.has(candidate.applicationId)} onClick={() => decide([candidate], "ELIMINATED")}>
                                        <X size={14} /> Eliminate
                                    </button>
                                </span>
                            ) : candidate.outcome ? (
                                <Badge tone={candidate.outcome === "QUALIFIED" ? "success" : "neutral"}>{candidate.outcome === "QUALIFIED" ? "Qualified" : "Eliminated"}{candidate.published ? "" : " · draft"}</Badge>
                            ) : (
                                <span className="subtle small">Awaiting result</span>
                            )}
                        </li>
                    ))}
                </ul>
            </div>

            {moving && <MoveSlot driveId={driveId} round={round} candidate={moving} onClose={() => setMoving(null)} onDone={onChange} />}
            <ConfirmDialog
                open={publishing}
                onClose={() => setPublishing(false)}
                onConfirm={publish}
                title={`Publish the results of ${round.name}?`}
                description={`${plural(qualified, "candidate")} qualify and ${plural(round.candidates.length - qualified, "candidate")} ${round.candidates.length - qualified === 1 ? "is" : "are"} eliminated. Everyone gets an email right away — congratulations or a thank-you — and results can't be changed afterwards.`}
                confirmLabel="Publish results"
            />
        </Card>
    );
};

// ---------------------------------------------------------------- Final selection

const FinalSelection = ({ drive, finalists, onDone }) => {
    const toast = useToast();
    const firstRole = (finalist) => drive.positions.find((position) => position._id === finalist.positions[0])?.role || drive.positions[0].role;
    const [decisions, setDecisions] = useState({});
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        setDecisions(Object.fromEntries(finalists.map((finalist) => [finalist.applicationId, { selected: null, role: firstRole(finalist) }])));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finalists]);

    const set = (id, changes) => setDecisions((current) => ({ ...current, [id]: { ...current[id], ...changes } }));
    const values = Object.values(decisions);
    const selected = values.filter((decision) => decision.selected === true).length;
    const ready = values.length === finalists.length && values.every((decision) => decision.selected !== null);
    const roles = useMemo(() => [...new Map(drive.positions.map((position) => [position.role, position.title])).entries()], [drive.positions]);

    const finalize = async () => {
        const response = await recruitmentApi.finalize(
            drive._id,
            finalists.map((finalist) => ({ applicationId: finalist.applicationId, selected: decisions[finalist.applicationId].selected, role: decisions[finalist.applicationId].role }))
        );
        toast.success(response.message);
        onDone();
    };

    return (
        <Card className="recruit-final" title={<h2 className="row"><Award size={18} /> Final selection</h2>} actions={<span className="subtle small">{plural(finalists.length, "finalist")}</span>}>
            <div className="stack">
                <p className="subtle small" style={{ margin: 0 }}>
                    {finalists.length
                        ? `Selected students join ${drive.club.name} with the role you choose. Everyone gets their result by email.`
                        : "No candidates are left in this drive. Complete it to close recruitment."}
                </p>
                <ul className="recruit-candidates">
                    {finalists.map((finalist, index) => {
                        const decision = decisions[finalist.applicationId] || {};
                        return (
                            <li key={finalist.applicationId} className={`recruit-candidate ${decision.selected === true ? "is-qualified" : decision.selected === false ? "is-eliminated" : ""}`} style={{ "--i": index }}>
                                <Avatar name={finalist.applicant.name} size="sm" />
                                <span className="grow">
                                    <strong>{finalist.applicant.name}</strong>
                                    <span className="subtle small">Applied for {finalist.positionTitles.join(", ")}</span>
                                </span>
                                {decision.selected && (
                                    <select className="select recruit-role-select" value={decision.role} onChange={(event) => set(finalist.applicationId, { role: event.target.value })} aria-label={`Role for ${finalist.applicant.name}`}>
                                        {roles.map(([role, title]) => (
                                            <option key={role} value={role}>
                                                {title} ({roleName(role)})
                                            </option>
                                        ))}
                                    </select>
                                )}
                                <span className="recruit-outcome" role="group" aria-label={`Decision for ${finalist.applicant.name}`}>
                                    <button type="button" className={decision.selected === true ? "is-on is-yes" : ""} aria-pressed={decision.selected === true} onClick={() => set(finalist.applicationId, { selected: true })}>
                                        <Check size={14} /> Select
                                    </button>
                                    <button type="button" className={decision.selected === false ? "is-on is-no" : ""} aria-pressed={decision.selected === false} onClick={() => set(finalist.applicationId, { selected: false })}>
                                        <X size={14} /> Not selected
                                    </button>
                                </span>
                            </li>
                        );
                    })}
                </ul>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                    <Button size="lg" onClick={() => setConfirming(true)} disabled={!ready}>
                        <Flag size={16} /> Complete recruitment
                    </Button>
                </div>
            </div>
            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={finalize}
                title="Complete recruitment?"
                description={`${plural(selected, "student")} will join ${drive.club.name} and get a welcome email; ${plural(finalists.length - selected, "student")} will be thanked. The drive is then closed.`}
                confirmLabel="Complete recruitment"
            />
        </Card>
    );
};

/** Rounds tab for the president (and a read-only view for the mentor). */
export const RoundsPanel = ({ drive, onDriveChange }) => {
    const canManage = drive.viewer.canManage;
    const { data, loading, error, reload } = useApi(() => recruitmentApi.rounds(drive._id), [drive._id]);
    const refresh = () => reload({ silent: true });

    if (["UPCOMING", "OPEN"].includes(drive.phase)) {
        return (
            <Card>
                <EmptyState icon={Users} title="Rounds start after applications close" description="Close applications from the actions above, or wait for the deadline. Then add a screening or interview round." />
            </Card>
        );
    }

    return (
        <AsyncContent loading={loading && !data} error={error} onRetry={reload}>
            {data && (
                <div className="stack-lg">
                    {!data.rounds.length && data.activeCount > 0 && canManage && (
                        <Alert type="info" title={`${plural(data.activeCount, "applicant")} waiting`}>
                            Add your first round — a screening to shortlist, or go straight to interviews. You can also finalise directly below.
                        </Alert>
                    )}
                    {data.rounds.map((round, index) => (
                        <RoundCard key={round._id} driveId={drive._id} round={round} number={index + 1} canManage={canManage} onChange={refresh} />
                    ))}
                    {canManage && data.canAddRound && <AddRound driveId={drive._id} number={data.rounds.length + 1} onDone={refresh} />}
                    {canManage && data.canFinalize && (
                        <FinalSelection
                            drive={drive}
                            finalists={data.finalists}
                            onDone={() => {
                                refresh();
                                onDriveChange();
                            }}
                        />
                    )}
                    {!data.rounds.length && !canManage && <EmptyState icon={Users} title="No rounds yet" description="The president hasn't started the selection rounds." />}
                </div>
            )}
        </AsyncContent>
    );
};
