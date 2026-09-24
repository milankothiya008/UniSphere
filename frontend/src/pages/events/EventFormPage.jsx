import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarPlus, Lock, Save, Send } from "lucide-react";
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
    venue: event.venue?._id || "",
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
    updateNote: ""
});

// Now in the campus timezone, as the "YYYY-MM-DDTHH:mm" string the date inputs use.
const useNowInput = () => {
    const [now, setNow] = useState(() => toDateTimeInput(new Date()));
    useEffect(() => {
        const timer = setInterval(() => setNow(toDateTimeInput(new Date())), 30000);
        return () => clearInterval(timer);
    }, []);
    return now;
};

const validate = (form, locked, { nowInput, isEdit }) => {
    const errors = {};
    const today = nowInput.slice(0, 10);
    if (!form.club) errors.club = "Choose a club";
    if (form.title.trim().length < 3) errors.title = "Title must be at least 3 characters";
    if (form.shortDescription.trim().length < 10) errors.shortDescription = "At least 10 characters";
    if (form.description.trim().length < 10) errors.description = "At least 10 characters";
    if (!locked) {
        if (!form.eventDate) errors.eventDate = "Pick a date";
        else if (form.eventDate < today) errors.eventDate = "Pick today or a future date";
        else if (form.eventDate === today && form.startTime <= nowInput.slice(11)) errors.startTime = "This time has already passed today";
        if (form.startTime >= form.endTime) errors.endTime = "End time must be after start time";
        if (!form.venue) errors.venue = "Choose a venue";
    }
    if (!form.registrationEnd) {
        errors.registrationEnd = "Set a registration deadline";
    } else if (form.registrationEnd <= nowInput) {
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
    const locked = isEdit && event && ["APPROVED", "PUBLISHED"].includes(event.status);

    useEffect(() => {
        if (event) {
            setForm(fromEvent(event));
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

    // Live venue availability for the chosen slot (approved/published events hold a venue).
    useEffect(() => {
        if (locked) {
            return undefined;
        }
        if (!form.eventDate || form.startTime >= form.endTime) {
            setVenues(reference.venues.map((venue) => ({ ...venue, available: undefined })));
            return undefined;
        }
        let active = true;
        referenceApi
            .availableVenues({ eventDate: form.eventDate, startTime: form.startTime, endTime: form.endTime, excludeEventId: id })
            .then((response) => active && setVenues(response.data))
            .catch(() => active && setVenues(reference.venues));
        return () => {
            active = false;
        };
    }, [form.eventDate, form.startTime, form.endTime, id, locked, reference.venues]);

    const errors = validate(form, locked, { nowInput, isEdit });
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

    const payload = () => {
        const common = {
            shortDescription: form.shortDescription.trim(),
            description: form.description.trim(),
            poster: form.poster || null,
            rules: form.rules,
            contact: { name: form.contactName, email: form.contactEmail, phone: form.contactPhone },
            maxParticipants: form.maxParticipants === "" ? null : Number(form.maxParticipants),
            registrationEnd: fromDateTimeInput(form.registrationEnd)
        };
        if (locked) {
            return { ...common, updateNote: form.updateNote.trim() || undefined };
        }
        return {
            ...common,
            club: form.club,
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
                toast.success(isEdit ? "Event updated" : "Draft saved — submit it for approval when ready");
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

    if (isEdit && event && !["DRAFT", "NEEDS_CHANGES", "APPROVED", "PUBLISHED"].includes(event.status)) {
        return <ErrorState error={{ status: 403, message: "This event can no longer be edited." }} />;
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
    const editableStatus = !isEdit || ["DRAFT", "NEEDS_CHANGES"].includes(event?.status);

    return (
        <AsyncContent loading={isEdit && existing.loading}>
            <PageHeader
                back={isEdit ? { to: `/events/${id}`, label: "Back to event" } : { to: "/events/manage", label: "Manage events" }}
                eyebrow={<><CalendarPlus size={14} /> {isEdit ? "Edit event" : "New event"}</>}
                title={isEdit ? event?.title || "Edit event" : "Create an event"}
                description={
                    locked
                        ? "This event is approved, so its schedule, venue and eligibility are locked. You can still update the details below."
                        : "Save a draft, then submit it to your club's faculty mentor for approval. It becomes public only after you publish it."
                }
            />

            <div className="stack-lg" style={{ maxWidth: 880 }}>
                {event?.status === "NEEDS_CHANGES" && event.reviewComment && (
                    <Alert type="warning" title="Changes requested by your mentor">
                        {event.reviewComment}
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
                            disabled={locked}
                        />
                        <Input className="span-2" label="Title" value={form.title} onChange={set("title")} maxLength={160} disabled={locked} error={fieldError("title")} required />
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

                <Card title={<h2 className="row">Schedule & venue {locked && <Lock size={15} className="muted" />}</h2>}>
                    <div className="form-grid">
                        <Input
                            label="Date"
                            type="date"
                            min={locked ? undefined : today}
                            value={form.eventDate}
                            onChange={set("eventDate")}
                            disabled={locked}
                            error={locked ? undefined : scheduleError("eventDate", form.eventDate)}
                            required
                        />
                        <div className="grid-2" style={{ gap: 12 }}>
                            <Input
                                label="Starts"
                                type="time"
                                min={!locked && form.eventDate === today ? nowInput.slice(11) : undefined}
                                value={form.startTime}
                                onChange={set("startTime")}
                                disabled={locked}
                                error={locked ? undefined : scheduleError("startTime", form.eventDate)}
                                required
                            />
                            <Input label="Ends" type="time" value={form.endTime} onChange={set("endTime")} disabled={locked} error={fieldError("endTime")} required />
                        </div>
                        <Select
                            className="span-2"
                            label="Venue"
                            value={form.venue}
                            onChange={set("venue")}
                            placeholder="Choose a venue"
                            disabled={locked}
                            error={fieldError("venue")}
                            hint={
                                locked
                                    ? undefined
                                    : form.eventDate
                                      ? "A venue can host only one event at a time. Venues booked or requested by another event in this slot are unavailable."
                                      : "Pick a date and time to see availability."
                            }
                            options={(locked && event ? [event.venue] : venues).map((venue) => ({
                                value: venue._id,
                                label: `${venue.name} · ${venue.location} · ${venue.capacity} seats${venue.available === false ? ` — unavailable (${bookingSummary(venue)})` : ""}`,
                                disabled: venue.available === false && venue._id !== form.venue
                            }))}
                            required
                        />
                        {!locked && selectedVenue?.available === false && (
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
                            disabled={locked}
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
                            label="Participant limit"
                            type="number"
                            min={1}
                            value={form.maxParticipants}
                            onChange={set("maxParticipants")}
                            hint={selectedVenue ? `Leave empty for no limit · venue holds ${selectedVenue.capacity}` : "Leave empty for no limit"}
                            error={fieldError("maxParticipants")}
                        />
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
                                        disabled={locked}
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
                                        disabled={locked}
                                    />
                                ))}
                            </div>
                        </Field>
                        <Input label="Eligibility notes" value={form.eligibilityNotes} onChange={set("eligibilityNotes")} placeholder="e.g. Teams of 2–4" disabled={locked} maxLength={1000} />
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

                {event?.status === "PUBLISHED" && (
                    <Card title="Notify participants">
                        <Textarea
                            label="Update note (optional)"
                            hint="If filled, registered students are notified and the update is posted to the campus feed."
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
                        <Save size={16} /> {editableStatus ? "Save draft" : "Save changes"}
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
