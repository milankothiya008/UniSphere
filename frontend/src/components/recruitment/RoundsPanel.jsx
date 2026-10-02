import { useEffect, useState } from "react";
import { Award, CalendarClock, Check, ClipboardList, Flag, Gift, Hourglass, ListOrdered, MapPin, MonitorPlay, Plus, Send, Users, Video, X } from "lucide-react";
import { recruitmentApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Alert, AsyncContent, Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Modal, Segmented, Select, Textarea } from "../ui";
import { ApplicationBadge } from "./RecruitmentParts";
import { ROUND_MODES } from "../../lib/constants";
import { formatDate, formatDateTime, formatTime, formatTimeRange, fromDateTimeInput, plural, toDateTimeInput } from "../../lib/format";

const MODE_ICONS = { SCREENING: ClipboardList, ONLINE: MonitorPlay, OFFLINE: MapPin };
const ROUND_STATUS = { DRAFT: ["Not scheduled", "neutral"], SCHEDULED: ["Scheduled", "info"], RESULTS_PUBLISHED: ["Results published", "success"] };

const addMinutes = (input, minutes) => (input ? toDateTimeInput(new Date(new Date(fromDateTimeInput(input)).getTime() + minutes * 60000)) : "");

// ---------------------------------------------------------------- Add a round

const AddRound = ({ driveId, positionId, number, onDone }) => {
    const toast = useToast();
    const [open, setOpen] = useState(number === 1);
    const [name, setName] = useState("");
    const [mode, setMode] = useState("SCREENING");
    const [busy, setBusy] = useState(false);
    const suggestions = { SCREENING: "Application screening", ONLINE: "Online interview", OFFLINE: "Interview" };

    const create = async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
            await recruitmentApi.createRound(driveId, positionId, { name: name.trim() || suggestions[mode], mode });
            toast.success(`Round ${number} added`);
            setName("");
            setOpen(false);
            onDone();
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(false);
        }
    };

    if (!open) {
        return (
            <button type="button" className="recruit-add-page recruit-add-round-toggle" onClick={() => setOpen(true)}>
                <Plus size={16} /> Add round {number}
            </button>
        );
    }

    return (
        <Card
            title={<h2 className="row"><Plus size={18} /> Add round {number}</h2>}
            className="recruit-add-round"
            actions={
                number > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setOpen(false)} aria-label="Close">
                        <X size={16} />
                    </button>
                )
            }
        >
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

const ScheduleForm = ({ driveId, positionId, clubId, round, candidates, onDone, onCancel }) => {
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
            ? referenceApi.availableVenues({ eventDate: startAt.slice(0, 10), startTime: startAt.slice(11, 16), endTime: computedEnd.slice(11, 16), club: clubId })
            : referenceApi.venues({ status: "ACTIVE", club: clubId });
        request.then((response) => active && setVenues(response.data)).catch(() => {});
        return () => {
            active = false;
        };
    }, [round.mode, startAt, computedEnd, clubId]);

    const submit = async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
            const response = await recruitmentApi.scheduleRound(driveId, positionId, round._id, {
                timing,
                startAt: fromDateTimeInput(startAt),
                endAt: timing === "COMMON" ? fromDateTimeInput(endAt) : undefined,
                slotMinutes: timing === "SLOTS" ? Number(slotMinutes) : undefined,
                venue: round.mode === "OFFLINE" ? venue : undefined,
                meetingLink: round.mode === "ONLINE" ? meetingLink.trim() : undefined,
                instructions
            });
            toast.success(round.status === "SCHEDULED" ? "Updated — candidates have been told the new details" : "Scheduled — invitations are on their way");
            clashNotice(toast, response.data?.warnings);
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
                            label: `${item.type === "LAB" ? `${item.departmentCodes.join("/")} lab · ` : ""}${item.name} · ${item.location}${item.available === false && item._id !== (round.venue?._id || round.venue) ? ` — booked (${item.bookedBy?.[0]?.title || "busy"})` : ""}`,
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

// Candidates applying for several roles can't be in two interviews at once; the server shifts their slots
// and lists anyone it couldn't place without a clash.
const clashNotice = (toast, warnings) => {
    if (warnings?.length) {
        toast.info(`${plural(warnings.length, "candidate")} also ${warnings.length === 1 ? "has" : "have"} an interview for ${warnings[0].clashWith} at ${warnings[0].at}. Move ${warnings.length === 1 ? "that slot" : "those slots"} if needed.`);
    }
};

const MoveSlot = ({ driveId, positionId, round, candidate, onClose, onDone }) => {
    const toast = useToast();
    const [value, setValue] = useState(toDateTimeInput(candidate.slot.startAt));
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true);
        try {
            const response = await recruitmentApi.moveSlot(driveId, positionId, round._id, candidate.applicationId, fromDateTimeInput(value));
            toast.success(`${candidate.applicant.name} has been told the new time`);
            clashNotice(toast, response.data?.warnings);
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

const RoundCard = ({ driveId, positionId, clubId, round, number, canManage, onChange }) => {
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
            await recruitmentApi.setOutcomes(driveId, positionId, round._id, ids.map((applicationId) => ({ applicationId, outcome })));
            onChange();
        } catch (error) {
            toast.error(error);
        } finally {
            setPending((current) => new Set([...current].filter((id) => !ids.includes(id))));
        }
    };

    const publish = async () => {
        const response = await recruitmentApi.publishRound(driveId, positionId, round._id);
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
            actions={
                <>
                    <Badge tone={tone} dot>
                        {statusLabel}
                    </Badge>
                    <ActionMenu
                        label={`${round.name} actions`}
                        items={[{ label: "Reschedule", icon: CalendarClock, onClick: () => setEditing(true), hidden: !(canManage && round.isCurrent && needsSchedule && round.status === "SCHEDULED" && !editing) }]}
                    />
                </>
            }
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
                    </div>
                )}
                {needsSchedule && canManage && round.isCurrent && (round.status === "DRAFT" || editing) && (
                    <>
                        {round.status === "DRAFT" && <Alert type="info">Set the time and {round.mode === "OFFLINE" ? "venue" : "meeting link"}. Every candidate gets an invitation, and reminders 1 hour and 10 minutes before.</Alert>}
                        <ScheduleForm driveId={driveId} positionId={positionId} clubId={clubId} round={round} candidates={round.candidates.length} onDone={() => { setEditing(false); onChange(); }} onCancel={editing ? () => setEditing(false) : null} />
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
                            <Avatar name={candidate.applicant.name} src={candidate.applicant.avatar} size="sm" />
                            <span className="grow">
                                <strong>{candidate.applicant.name}</strong>
                                <span className="subtle small">{candidate.applicant.email}</span>
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

            {moving && <MoveSlot driveId={driveId} positionId={positionId} round={round} candidate={moving} onClose={() => setMoving(null)} onDone={onChange} />}
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

const DECISIONS = [
    { value: "OFFER", label: "Offer", icon: Gift, tone: "is-yes" },
    { value: "RESERVE", label: "Reserve", icon: ListOrdered, tone: "is-maybe" },
    { value: "NOT_SELECTED", label: "Not selected", icon: X, tone: "is-no" }
];

const FinalSelection = ({ drive, data, onDone }) => {
    const toast = useToast();
    const { position, finalists } = data;
    const [decisions, setDecisions] = useState({});
    const [offerDays, setOfferDays] = useState(position.offerDays || 3);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        setDecisions(Object.fromEntries(finalists.map((finalist) => [finalist.applicationId, null])));
    }, [finalists]);

    const count = (value) => Object.values(decisions).filter((decision) => decision === value).length;
    const offers = count("OFFER");
    const ready = finalists.every((finalist) => decisions[finalist.applicationId]);
    const overBooked = position.openings && offers > position.openings;
    const days = Number(offerDays);
    const daysValid = Number.isInteger(days) && days >= 1 && days <= 14;

    const finalize = async () => {
        const response = await recruitmentApi.finalize(drive._id, position._id, {
            offerDays: days,
            decisions: finalists.map((finalist) => ({ applicationId: finalist.applicationId, decision: decisions[finalist.applicationId] }))
        });
        toast.success(response.message);
        onDone();
    };

    return (
        <Card
            className="recruit-final"
            title={
                <h2 className="row">
                    <Award size={18} /> Final selection · {position.title}
                </h2>
            }
            actions={<span className="subtle small">{plural(finalists.length, "finalist")}</span>}
        >
            <div className="stack">
                <p className="subtle small" style={{ margin: 0 }}>
                    {finalists.length
                        ? `Offer the role to your picks${position.openings ? ` (${plural(position.openings, "opening")})` : ""}, keep a reserve list for seats that free up, and thank the rest. Students who applied for several roles accept only one offer.`
                        : "No candidates are left for this role. Finish it to close its selection."}
                </p>
                {finalists.length > 0 && (
                    <div className="recruit-final-tally">
                        <span className={overBooked ? "is-over" : ""}>
                            <Gift size={14} /> {offers}
                            {position.openings ? ` / ${position.openings}` : ""} offers
                        </span>
                        <span>
                            <ListOrdered size={14} /> {count("RESERVE")} reserve
                        </span>
                        <span>
                            <X size={14} /> {count("NOT_SELECTED")} not selected
                        </span>
                    </div>
                )}
                <ul className="recruit-candidates">
                    {finalists.map((finalist, index) => {
                        const decision = decisions[finalist.applicationId];
                        return (
                            <li
                                key={finalist.applicationId}
                                className={`recruit-candidate ${decision === "OFFER" ? "is-qualified" : decision === "NOT_SELECTED" ? "is-eliminated" : decision === "RESERVE" ? "is-reserve" : ""}`}
                                style={{ "--i": Math.min(index, 12) }}
                            >
                                <Avatar name={finalist.applicant.name} src={finalist.applicant.avatar} size="sm" />
                                <span className="grow">
                                    <strong>{finalist.applicant.name}</strong>
                                    <span className="subtle small">{finalist.applicant.email}</span>
                                </span>
                                <span className="recruit-outcome" role="group" aria-label={`Decision for ${finalist.applicant.name}`}>
                                    {DECISIONS.map((option) => {
                                        const Icon = option.icon;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                className={decision === option.value ? `is-on ${option.tone}` : ""}
                                                aria-pressed={decision === option.value}
                                                onClick={() => setDecisions((current) => ({ ...current, [finalist.applicationId]: option.value }))}
                                            >
                                                <Icon size={14} /> {option.label}
                                            </button>
                                        );
                                    })}
                                </span>
                            </li>
                        );
                    })}
                </ul>
                {overBooked && <Alert type="warning">{position.title} has {plural(position.openings, "opening")}. Put the others on the reserve list — they get an offer if a seat frees up.</Alert>}
                <div className="recruit-final-footer">
                    {finalists.length > 0 && (
                        <Input
                            label="Days to answer an offer"
                            type="number"
                            min={1}
                            max={14}
                            value={offerDays}
                            onChange={(event) => setOfferDays(event.target.value)}
                            error={daysValid ? undefined : "1 to 14 days"}
                        />
                    )}
                    <Button size="lg" onClick={() => setConfirming(true)} disabled={!ready || overBooked || !daysValid}>
                        <Flag size={16} /> {finalists.length ? "Send offers" : `Finish ${position.title}`}
                    </Button>
                </div>
            </div>
            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={finalize}
                title={finalists.length ? `Send the ${position.title} results?` : `Finish ${position.title}?`}
                description={
                    finalists.length
                        ? `${plural(offers, "student")} ${offers === 1 ? "gets an offer" : "get offers"} to answer within ${plural(days, "day")}, ${count("RESERVE")} ${count("RESERVE") === 1 ? "goes" : "go"} on the reserve list and ${count("NOT_SELECTED")} ${count("NOT_SELECTED") === 1 ? "is" : "are"} thanked. Everyone is emailed right away.`
                        : "Nobody is waiting for this role, so its selection closes."
                }
                confirmLabel={finalists.length ? "Send results" : "Finish"}
            />
        </Card>
    );
};

const OFFER_ORDER = { OFFERED: 0, ACCEPTED: 1, RESERVE: 2, DECLINED: 3, EXPIRED: 4 };

/** After the final selection: who has an offer, who joined, and the reserve list for freed seats. */
const OffersCard = ({ drive, data, canManage, onChange }) => {
    const toast = useToast();
    const [offering, setOffering] = useState(null);
    const { position, seats } = data;
    const offers = [...data.offers].sort((a, b) => OFFER_ORDER[a.status] - OFFER_ORDER[b.status]);

    const offer = async () => {
        const response = await recruitmentApi.offerToReserve(drive._id, position._id, offering.applicationId);
        toast.success(response.message);
        onChange();
    };

    return (
        <Card
            className="recruit-offers"
            title={
                <h2 className="row">
                    <Gift size={18} /> Offers · {position.title}
                </h2>
            }
        >
            <div className="stack">
                <div className="recruit-seats">
                    <div>
                        <strong>{seats.accepted}</strong>
                        <span>joined</span>
                    </div>
                    <div>
                        <strong>{seats.pending}</strong>
                        <span>waiting for an answer</span>
                    </div>
                    <div>
                        <strong>{seats.open === null ? "—" : seats.open}</strong>
                        <span>{seats.openings ? `open of ${seats.openings}` : "no seat limit"}</span>
                    </div>
                </div>
                {canManage && data.canOfferReserve && (
                    <Alert type="info" title="A seat is free">
                        Not every opening is taken or offered. Offer it to someone on the reserve list — they're emailed right away.
                    </Alert>
                )}
                {offers.length ? (
                    <ul className="recruit-candidates">
                        {offers.map((item, index) => (
                            <li key={item.applicationId} className="recruit-candidate" style={{ "--i": Math.min(index, 12) }}>
                                <Avatar name={item.applicant.name} src={item.applicant.avatar} size="sm" />
                                <span className="grow">
                                    <strong>{item.applicant.name}</strong>
                                    <span className="subtle small">
                                        {item.status === "OFFERED" ? (
                                            <>
                                                <Hourglass size={12} /> Answer by {formatDateTime(item.offerExpiresAt)}
                                            </>
                                        ) : item.respondedAt ? (
                                            `Answered ${formatDateTime(item.respondedAt)}`
                                        ) : (
                                            item.applicant.email
                                        )}
                                    </span>
                                </span>
                                <ApplicationBadge status={item.status} />
                                {canManage && item.status === "RESERVE" && data.canOfferReserve && (
                                    <Button size="sm" variant="secondary" onClick={() => setOffering(item)}>
                                        <Gift size={14} /> Offer seat
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="subtle">No offers were made for this role.</p>
                )}
            </div>
            <ConfirmDialog
                open={Boolean(offering)}
                onClose={() => setOffering(null)}
                onConfirm={offer}
                title={`Offer ${position.title} to ${offering?.applicant.name}?`}
                description={`They're emailed right away and have ${plural(position.offerDays || 3, "day")} to answer.`}
                confirmLabel="Send offer"
            />
        </Card>
    );
};

/** Selection for one role: its rounds, the final selection and the offers. Read-only for the mentor. */
export const RoundsPanel = ({ drive, position, onDriveChange }) => {
    const canManage = drive.viewer.canManage;
    const { data, loading, error, reload } = useApi(() => recruitmentApi.rounds(drive._id, position._id), [drive._id, position._id]);
    const refresh = () => {
        reload({ silent: true });
        onDriveChange();
    };

    if (["UPCOMING", "OPEN"].includes(drive.phase)) {
        return (
            <Card>
                <EmptyState icon={Users} title="Selection starts after applications close" description="Close applications from the actions, or wait for the deadline. Then each role gets its own screening and interview rounds." />
            </Card>
        );
    }

    return (
        <AsyncContent loading={loading && !data} error={error} onRetry={reload}>
            {data && (
                <div className="stack-lg">
                    {!data.rounds.length && data.activeCount > 0 && canManage && !data.position.finalizedAt && (
                        <Alert type="info" title={`${plural(data.activeCount, "applicant")} for ${data.position.title}`}>
                            Add the first round — a screening to shortlist, or go straight to interviews. You can also make offers directly below.
                        </Alert>
                    )}
                    {data.rounds.map((round, index) => (
                        <RoundCard key={round._id} driveId={drive._id} positionId={position._id} clubId={drive.club._id} round={round} number={index + 1} canManage={canManage} onChange={refresh} />
                    ))}
                    {canManage && data.canAddRound && <AddRound driveId={drive._id} positionId={position._id} number={data.rounds.length + 1} onDone={refresh} />}
                    {canManage && data.canFinalize && <FinalSelection drive={drive} data={data} onDone={refresh} />}
                    {data.position.finalizedAt && <OffersCard drive={drive} data={data} canManage={canManage && drive.status === "PUBLISHED"} onChange={refresh} />}
                    {!data.rounds.length && !data.position.finalizedAt && !canManage && <EmptyState icon={Users} title="No rounds yet" description="The president hasn't started the selection for this role." />}
                </div>
            )}
        </AsyncContent>
    );
};
