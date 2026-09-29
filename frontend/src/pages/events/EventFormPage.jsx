import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarPlus, Save, Send, User, Users } from "lucide-react";
import { eventApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import {
    Alert,
    ApiErrorAlert,
    AsyncContent,
    Button,
    Card,
    Checkbox,
    EmptyState,
    ErrorState,
    Field,
    ImageUpload,
    Input,
    PageHeader,
    Segmented,
    Select,
    Textarea
} from "../../components/ui";
import { EVENT_CATEGORIES } from "../../lib/constants";
import { batchLabel, fromDateTimeInput, humanize, toDateInput, toDateTimeInput } from "../../lib/format";

const blank = {
    club: "",
    title: "",
    shortDescription: "",
    description: "",
    category: "TECHNOLOGY",
    poster: "",
    eventDate: "",
    startTime: "10:00",
    endTime: "12:00",
    venue: "",
    maxParticipants: "",
    registrationStart: "",
    registrationEnd: "",
    departments: [],
    batches: [],
    eligibilityNotes: "",
    rules: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    participationMode: "INDIVIDUAL",
    minTeamSize: 2,
    maxTeamSize: 4,
    updateNote: ""
};

const fromEvent = (event) => ({
    club: event.club._id,
    title: event.title,
    shortDescription: event.shortDescription,
    description: event.description,
    category: event.category,
    poster: event.poster || "",
    eventDate: toDateInput(event.startAt),
    startTime: event.startTime,
    endTime: event.endTime,
    venue: event.venue?._id || event.venue || "",
    maxParticipants: event.maxParticipants ?? "",
    registrationStart: toDateTimeInput(event.registrationStart),
    registrationEnd: toDateTimeInput(event.registrationEnd),
    departments: event.eligibility?.departments || [],
    batches: event.eligibility?.batches || [],
    eligibilityNotes: event.eligibility?.notes || "",
    rules: event.rules || "",
    contactName: event.contact?.name || "",
    contactEmail: event.contact?.email || "",
    contactPhone: event.contact?.phone || "",
    participationMode: event.participationMode || "INDIVIDUAL",
    minTeamSize: event.participationMode === "TEAM" ? event.minTeamSize : 2,
    maxTeamSize: event.participationMode === "TEAM" ? event.maxTeamSize : 4,
    updateNote: event.revision?.note || ""
});

// A published event with pending changes opens with those changes, so the club edits the proposal
// (a rejected proposal starts again from the live event).
const formSource = (event) =>
    event.revision && event.revision.status !== "REJECTED" ? { ...event, ...event.revision.changes, revision: event.revision } : event;

// Now in the campus timezone, as the "YYYY-MM-DDTHH:mm" string the date inputs use.
const useNowInput = () => {
    const [now, setNow] = useState(() => toDateTimeInput(new Date()));
    useEffect(() => {
        const timer = setInterval(() => setNow(toDateTimeInput(new Date())), 30000);
        return () => clearInterval(timer);
    }, []);
    return now;
};

const validate = (form, { nowInput, isEdit, original }) => {
    const errors = {};
    const today = nowInput.slice(0, 10);
    if (!form.club) errors.club = "Choose a club";
    if (form.title.trim().length < 3) errors.title = "Title must be at least 3 characters";
    if (form.shortDescription.trim().length < 10) errors.shortDescription = "At least 10 characters";
    if (form.description.trim().length < 10) errors.description = "At least 10 characters";
    if (!form.eventDate) errors.eventDate = "Pick a date";
    else if (form.eventDate < today) errors.eventDate = "Pick today or a future date";
    else if (form.eventDate === today && form.startTime <= nowInput.slice(11)) errors.startTime = "This time has already passed today";
    if (form.startTime >= form.endTime) errors.endTime = "End time must be after start time";
    if (!form.venue) errors.venue = "Choose a venue";
    const deadlineUnchanged = isEdit && original && form.registrationEnd === original.registrationEnd;
    if (!form.registrationEnd) {
        errors.registrationEnd = "Set a registration deadline";
    } else if (form.registrationEnd <= nowInput && !deadlineUnchanged) {
        errors.registrationEnd = "The deadline must be in the future";
    } else if (form.eventDate && `${form.registrationEnd}` > `${form.eventDate}T${form.startTime}`) {
        errors.registrationEnd = "Registration must close before the event starts";
    }
    if (form.registrationStart && form.registrationEnd && form.registrationStart >= form.registrationEnd) {
        errors.registrationStart = "Must be before the deadline";
    } else if (!isEdit && form.registrationStart && form.registrationStart < nowInput) {
        errors.registrationStart = "Can't be in the past — leave it empty to open when published";
    }
    if (form.maxParticipants !== "" && (!Number.isInteger(Number(form.maxParticipants)) || Number(form.maxParticipants) < 1)) {
        errors.maxParticipants = "Enter a positive whole number";
    }
    if (form.participationMode === "TEAM") {
        const min = Number(form.minTeamSize);
        const max = Number(form.maxTeamSize);
        if (!Number.isInteger(max) || max < 2 || max > 20) errors.maxTeamSize = "2 to 20 members";
        if (!Number.isInteger(min) || min < 1 || min > max) errors.minTeamSize = "At least 1, and not above the maximum";
    }
    return errors;
};

const bookingSummary = (venue) =>
    (venue.bookedBy || []).map((booking) => `${booking.startTime}–${booking.endTime} ${booking.title}${booking.pendingApproval ? ", pending" : ""}`).join("; ") || "booked";

const EventFormPage = () => {
    const { id } = useParams();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { eventClubs, reference } = useWorkspace();
    const isEdit = Boolean(id);

    const existing = useApi(() => eventApi.get(id), [id], { enabled: isEdit });

    const [form, setForm] = useState({ ...blank, club: params.get("club") || "" });
    const [touched, setTouched] = useState(false);
    const [venues, setVenues] = useState([]);
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    const nowInput = useNowInput();
    const today = nowInput.slice(0, 10);

    const event = existing.data;
    const original = useMemo(() => (event ? fromEvent(formSource(event)) : null), [event]);
    // draft: edited directly · reapprove: approved, not public yet · live: published (changes are reviewed first)
    const mode = !isEdit || !event ? "draft" : ["DRAFT", "NEEDS_CHANGES"].includes(event.status) ? "draft" : event.status === "APPROVED" ? "reapprove" : "live";
    const hasEntries = Boolean(event && (event.registeredCount > 0 || event.waitlistCount > 0));

    useEffect(() => {
        if (event) {
            setForm(fromEvent(formSource(event)));
        }
    }, [event]);

    const clubOptions = useMemo(() => {
        if (isEdit && event) {
            return [{ value: event.club._id, label: event.club.name }];
        }
        return eventClubs.map((membership) => ({ value: membership.club._id, label: membership.club.name }));
    }, [isEdit, event, eventClubs]);

    useEffect(() => {
        if (!form.club && clubOptions.length === 1) {
            setForm((prev) => ({ ...prev, club: clubOptions[0].value }));
        }
    }, [clubOptions, form.club]);

    // Live venue availability for the chosen slot (approved/published events hold a venue). Labs are
    // listed only for the event's audience: its departments, or else its club's.
    const audienceKey = form.departments.slice().sort().join(",");
    useEffect(() => {
        let active = true;
        const audience = { club: form.club || undefined, departments: audienceKey || undefined };
        const request =
            !form.eventDate || form.startTime >= form.endTime
                ? referenceApi.venues({ status: "ACTIVE", ...audience }).then((response) => response.data.map((venue) => ({ ...venue, available: undefined })))
                : referenceApi.availableVenues({ eventDate: form.eventDate, startTime: form.startTime, endTime: form.endTime, excludeEventId: id, ...audience }).then((response) => response.data);
        request.then((list) => active && setVenues(list)).catch(() => active && setVenues(reference.venues));
        return () => {
            active = false;
        };
    }, [form.eventDate, form.startTime, form.endTime, form.club, audienceKey, id, reference.venues]);

    const errors = validate(form, { nowInput, isEdit, original });
    const eventStartInput = form.eventDate ? `${form.eventDate}T${form.startTime}` : undefined;
    const earliestDeadline = form.registrationStart && form.registrationStart > nowInput ? form.registrationStart : nowInput;
    const hasErrors = Object.keys(errors).length > 0;
    const selectedVenue = venues.find((venue) => venue._id === form.venue) || reference.venues.find((venue) => venue._id === form.venue);

    const set = (field) => (eventOrValue) =>
        setForm((prev) => ({ ...prev, [field]: eventOrValue?.target ? eventOrValue.target.value : eventOrValue }));

    const toggle = (field, value) =>
        setForm((prev) => ({
            ...prev,
            [field]: prev[field].includes(value) ? prev[field].filter((item) => item !== value) : [...prev[field], value]
        }));

    const isTeam = form.participationMode === "TEAM";
    const payload = () => {
        const team = isTeam
            ? { participationMode: "TEAM", minTeamSize: Number(form.minTeamSize), maxTeamSize: Number(form.maxTeamSize) }
            : { participationMode: "INDIVIDUAL" };
        return {
            shortDescription: form.shortDescription.trim(),
            description: form.description.trim(),
            poster: form.poster || null,
            rules: form.rules,
            contact: { name: form.contactName, email: form.contactEmail, phone: form.contactPhone },
            maxParticipants: form.maxParticipants === "" ? null : Number(form.maxParticipants),
            registrationEnd: fromDateTimeInput(form.registrationEnd),
            ...(hasEntries ? {} : team),
            ...(mode === "live" ? { updateNote: form.updateNote.trim() } : {}),
            ...(isEdit ? {} : { club: form.club }),
            title: form.title.trim(),
            category: form.category,
            eventDate: form.eventDate,
            startTime: form.startTime,
            endTime: form.endTime,
            venue: form.venue,
            registrationStart: form.registrationStart ? fromDateTimeInput(form.registrationStart) : undefined,
            eligibility: { departments: form.departments, batches: form.batches, notes: form.eligibilityNotes }
        };
    };

    const save = async (andSubmit) => {
        setTouched(true);
        if (hasErrors) {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        setPending(andSubmit ? "submit" : "save");
        setError(null);
        try {
            const body = payload();
            const response = isEdit ? await eventApi.update(id, body) : await eventApi.create(body);
            const saved = response.data;
            if (andSubmit) {
                await eventApi.submit(saved._id);
                toast.success("Saved and sent to your faculty mentor for approval");
            } else {
                toast.success(isEdit ? response.message : "Draft saved — submit it for approval when ready");
            }
            navigate(`/events/${saved._id}`);
        } catch (err) {
            setError(err);
            window.scrollTo({ top: 0, behavior: "smooth" });
        } finally {
            setPending(null);
        }
    };

    if (isEdit && existing.error) {
        return <ErrorState error={existing.error} onRetry={existing.reload} />;
    }

    if (isEdit && event && !event.viewer?.canManage) {
        return <ErrorState error={{ status: 403, message: "You can't edit this event." }} />;
    }

    if (isEdit && event && event.status === "PENDING_APPROVAL") {
        return <ErrorState error={{ status: 409, message: "This event is with your faculty mentor for review. You can edit it again once they respond." }} />;
    }

    if (isEdit && event && !event.viewer?.canEdit) {
        return (
            <ErrorState
                error={{
                    status: 409,
                    message: new Date(event.startAt) <= new Date() ? "This event has already started, so its details can no longer be changed." : "This event can no longer be edited."
                }}
            />
        );
    }

    if (!isEdit && eventClubs.length === 0) {
        return (
            <EmptyState
                icon={CalendarPlus}
                title="You can't create events yet"
                description="Events are created by club presidents or members with an event role. Join a club or ask your president for a role."
            />
        );
    }

    const fieldError = (name) => (touched ? errors[name] : undefined);
    // Date and time mistakes are shown as soon as a value is picked, not only after saving.
    const scheduleError = (name, value) => (touched || value ? errors[name] : undefined);
    const editableStatus = mode === "draft";
    const revision = event?.revision;

    return (
        <AsyncContent loading={isEdit && existing.loading}>
            <PageHeader
                back={isEdit ? { to: `/events/${id}`, label: "Back to event" } : { to: "/events/manage", label: "Manage events" }}
                eyebrow={<><CalendarPlus size={14} /> {isEdit ? "Edit event" : "New event"}</>}
                title={isEdit ? event?.title || "Edit event" : "Create an event"}
                description={
                    mode === "live"
                        ? "Everything can be changed until the event starts. Your faculty mentor reviews the changes first — students keep seeing the current details until they're approved and you publish them."
                        : mode === "reapprove"
                          ? "This event is approved but not public yet. Saving changes sends it back to your faculty mentor for approval."
                          : "Save a draft, then submit it to your club's faculty mentor for approval. It becomes public only after you publish it."
                }
            />

            <div className="stack-lg" style={{ maxWidth: 880 }}>
                {event?.status === "NEEDS_CHANGES" && event.reviewComment && (
                    <Alert type="warning" title="Changes requested by your mentor">
                        {event.reviewComment}
                    </Alert>
                )}
                {revision?.status === "PENDING_APPROVAL" && (
                    <Alert type="info" title="Your earlier changes are waiting for approval">
                        The form shows them. Saving again replaces them and restarts the review.
                    </Alert>
                )}
                {revision?.status === "APPROVED" && (
                    <Alert type="success" title="Your changes were approved">
                        Publish them from the event page. Editing again sends them back for review.
                    </Alert>
                )}
                {revision?.status === "NEEDS_CHANGES" && (
                    <Alert type="warning" title={`${revision.reviewedBy?.name || "Your mentor"} asked for changes`}>
                        {revision.reviewComment}
                    </Alert>
                )}
                {revision?.status === "REJECTED" && (
                    <Alert type="error" title="Your last changes were not approved">
                        {revision.reviewComment} The form shows the live event.
                    </Alert>
                )}
                <ApiErrorAlert error={error} />
                {touched && hasErrors && <Alert type="error">Please fix the highlighted fields.</Alert>}

                <Card title="Basics">
                    <div className="form-grid">
                        <Select
                            label="Club"
                            value={form.club}
                            onChange={set("club")}
                            placeholder="Choose a club"
                            options={clubOptions}
                            disabled={isEdit}
                            error={fieldError("club")}
                            required
                        />
                        <Select
                            label="Category"
                            value={form.category}
                            onChange={set("category")}
                            options={EVENT_CATEGORIES.map((value) => ({ value, label: humanize(value) }))}
                        />
                        <Input className="span-2" label="Title" value={form.title} onChange={set("title")} maxLength={160} error={fieldError("title")} required />
                        <Input
                            className="span-2"
                            label="Short description"
                            hint="Shown on event cards and in the feed (max 280 characters)"
                            value={form.shortDescription}
                            onChange={set("shortDescription")}
                            maxLength={280}
                            error={fieldError("shortDescription")}
                            required
                        />
                        <Textarea
                            className="span-2"
                            label="Full description"
                            value={form.description}
                            onChange={set("description")}
                            rows={6}
                            maxLength={8000}
                            error={fieldError("description")}
                            required
                        />
                        <div className="span-2">
                            <ImageUpload label="Poster" value={form.poster} onChange={set("poster")} folder="event-posters" wide />
                        </div>
                    </div>
                </Card>

                <Card title="Schedule & venue">
                    <div className="form-grid">
                        <Input
                            label="Date"
                            type="date"
                            min={today}
                            value={form.eventDate}
                            onChange={set("eventDate")}
                            error={scheduleError("eventDate", form.eventDate)}
                            required
                        />
                        <div className="grid-2" style={{ gap: 12 }}>
                            <Input
                                label="Starts"
                                type="time"
                                min={form.eventDate === today ? nowInput.slice(11) : undefined}
                                value={form.startTime}
                                onChange={set("startTime")}
                                error={scheduleError("startTime", form.eventDate)}
                                required
                            />
                            <Input label="Ends" type="time" value={form.endTime} onChange={set("endTime")} error={fieldError("endTime")} required />
                        </div>
                        <Select
                            className="span-2"
                            label="Venue"
                            value={form.venue}
                            onChange={set("venue")}
                            placeholder="Choose a venue"
                            error={fieldError("venue")}
                            hint={
                                form.eventDate
                                    ? "A venue can host only one event at a time. Venues booked or requested by another event in this slot are unavailable."
                                    : "Pick a date and time to see availability."
                            }
                            options={venues.map((venue) => ({
                                value: venue._id,
                                label: `${venue.type === "LAB" ? `${venue.departmentCodes.join("/")} lab · ` : ""}${venue.name} · ${venue.location} · ${venue.capacity} seats${venue.available === false ? ` — unavailable (${bookingSummary(venue)})` : ""}`,
                                disabled: venue.available === false && venue._id !== form.venue
                            }))}
                            required
                        />
                        {selectedVenue?.available === false && (
                            <div className="span-2">
                                <Alert type="warning" title={`${selectedVenue.name} is not free in this slot`}>
                                    <ul className="booking-list">
                                        {(selectedVenue.bookedBy || []).map((booking) => (
                                            <li key={`${booking.title}-${booking.startTime}`}>
                                                <strong>
                                                    {booking.startTime}–{booking.endTime}
                                                </strong>{" "}
                                                {booking.title}
                                                {booking.club ? ` · ${booking.club}` : ""}
                                                {booking.pendingApproval ? " (awaiting approval)" : ""}
                                            </li>
                                        ))}
                                    </ul>
                                    Choose another venue or time.
                                </Alert>
                            </div>
                        )}
                    </div>
                </Card>

                <Card title="Registration">
                    <div className="form-grid">
                        <Input
                            label="Registration opens"
                            type="datetime-local"
                            min={isEdit ? undefined : nowInput}
                            max={eventStartInput}
                            value={form.registrationStart}
                            onChange={set("registrationStart")}
                            hint="Leave empty to open as soon as the event is published"
                            error={fieldError("registrationStart")}
                        />
                        <Input
                            label="Registration deadline"
                            type="datetime-local"
                            min={earliestDeadline}
                            max={eventStartInput}
                            value={form.registrationEnd}
                            onChange={set("registrationEnd")}
                            hint="Must be in the future and before the event starts"
                            error={scheduleError("registrationEnd", form.registrationEnd)}
                            required
                        />
                        <Input
                            label={isTeam ? "Team limit" : "Participant limit"}
                            type="number"
                            min={1}
                            value={form.maxParticipants}
                            onChange={set("maxParticipants")}
                            hint={
                                isTeam
                                    ? `Number of teams · leave empty for no limit${selectedVenue ? ` · venue fits ${Math.floor(selectedVenue.capacity / Math.max(1, Number(form.maxTeamSize) || 1))} full teams` : ""}`
                                    : selectedVenue
                                      ? `Leave empty for no limit · venue holds ${selectedVenue.capacity}`
                                      : "Leave empty for no limit"
                            }
                            error={fieldError("maxParticipants")}
                        />
                    </div>
                    <div className="team-settings">
                        <Field
                            label="Who registers?"
                            hint={
                                hasEntries
                                    ? "Can't be changed once students have registered."
                                    : isTeam
                                      ? "A team leader registers the team and invites teammates, who join by accepting (like Unstop)."
                                      : "Each student registers on their own."
                            }
                        >
                            <Segmented
                                label="Who registers"
                                value={form.participationMode}
                                onChange={(value) => !hasEntries && set("participationMode")(value)}
                                options={[
                                    { value: "INDIVIDUAL", label: <><User size={14} /> Individuals</> },
                                    { value: "TEAM", label: <><Users size={14} /> Teams</> }
                                ]}
                            />
                        </Field>
                        {isTeam && (
                            <div className="grid-2" style={{ gap: 12 }}>
                                <Input label="Minimum team size" type="number" min={1} max={20} value={form.minTeamSize} onChange={set("minTeamSize")} disabled={hasEntries} error={fieldError("minTeamSize")} hint="Including the leader" />
                                <Input label="Maximum team size" type="number" min={2} max={20} value={form.maxTeamSize} onChange={set("maxTeamSize")} disabled={hasEntries} error={fieldError("maxTeamSize")} />
                            </div>
                        )}
                    </div>
                    <div className="stack" style={{ marginTop: 18 }}>
                        <Field label="Eligible departments" hint="Leave all unchecked to allow every department">
                            <div className="row">
                                {reference.departments.map((department) => (
                                    <Checkbox
                                        key={department._id}
                                        label={department.code}
                                        checked={form.departments.includes(department.code)}
                                        onChange={() => toggle("departments", department.code)}
                                    />
                                ))}
                            </div>
                        </Field>
                        <Field label="Eligible batches" hint="Leave all unchecked to allow every batch">
                            <div className="row">
                                {reference.batches.map((batch) => (
                                    <Checkbox
                                        key={batch._id}
                                        label={batchLabel(batch.code)}
                                        checked={form.batches.includes(batch.code)}
                                        onChange={() => toggle("batches", batch.code)}
                                    />
                                ))}
                            </div>
                        </Field>
                        <Input label="Eligibility notes" value={form.eligibilityNotes} onChange={set("eligibilityNotes")} placeholder="e.g. Bring a student ID" maxLength={1000} />
                    </div>
                </Card>

                <Card title="Rules & contact">
                    <div className="form-grid">
                        <Textarea className="span-2" label="Rules & guidelines" value={form.rules} onChange={set("rules")} rows={5} maxLength={8000} />
                        <Input label="Contact person" value={form.contactName} onChange={set("contactName")} maxLength={120} />
                        <Input label="Contact email" type="email" value={form.contactEmail} onChange={set("contactEmail")} />
                        <Input label="Contact phone" type="tel" value={form.contactPhone} onChange={set("contactPhone")} maxLength={30} />
                    </div>
                </Card>

                {mode === "live" && (
                    <Card title="Tell registered students">
                        <Textarea
                            label="Message (optional)"
                            hint="Sent to everyone registered, together with the list of what changed, once the changes are approved and published. With no other changes, it's posted right away."
                            value={form.updateNote}
                            onChange={set("updateNote")}
                            maxLength={2000}
                        />
                    </Card>
                )}

                <div className="form-actions">
                    <Button variant="secondary" onClick={() => navigate(-1)} disabled={Boolean(pending)}>
                        Cancel
                    </Button>
                    <Button variant={editableStatus ? "secondary" : "primary"} onClick={() => save(false)} loading={pending === "save"} disabled={Boolean(pending)}>
                        {editableStatus ? <Save size={16} /> : <Send size={16} />}{" "}
                        {editableStatus ? "Save draft" : mode === "reapprove" ? "Save & send for approval" : "Send changes for approval"}
                    </Button>
                    {editableStatus && (
                        <Button onClick={() => save(true)} loading={pending === "submit"} disabled={Boolean(pending)}>
                            <Send size={16} /> Save & submit for approval
                        </Button>
                    )}
                </div>
            </div>
        </AsyncContent>
    );
};

export default EventFormPage;
