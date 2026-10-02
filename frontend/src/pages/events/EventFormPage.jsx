import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarPlus, ClipboardList, Plus, Save, Send, Trash2, User, Users } from "lucide-react";
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
    Switch,
    Textarea
} from "../../components/ui";
import { EVENT_CATEGORIES } from "../../lib/constants";
import { ScheduleCheck } from "../../components/events/ScheduleCheck";
import { FormSection, Stepper, WizardHeader, WizardNav } from "../../components/forms/Wizard";
import { QuestionBuilder, questionProblem, toQuestionPayload, withKeys } from "../../components/forms/QuestionBuilder";
import { batchLabel, fromDateTimeInput, humanize, toDateInput, toDateTimeInput } from "../../lib/format";

const blank = {
    club: "",
    title: "",
    shortDescription: "",
    description: "",
    category: "TECHNOLOGY",
    poster: "",
    eventDate: "",
    // Multi-day / overnight events: the day it ends ("" = same day).
    endDate: "",
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
    certificatesEnabled: false,
    registrationForm: { enabled: false, questions: [] },
    budgetItems: [],
    equipment: [],
    budgetNote: "",
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
    endDate: event.endDate ? toDateInput(event.endAt) : "",
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
    certificatesEnabled: Boolean(event.certificatesEnabled),
    registrationForm: { enabled: Boolean(event.registrationForm?.enabled), questions: withKeys(event.registrationForm?.questions || []) },
    budgetItems: (event.budgetItems || []).map((row) => ({
        item: row.item,
        quantity: String(row.quantity),
        unitCost: String(row.unitCost),
        note: row.note || ""
    })),
    equipment: (event.equipment || []).map((row) => ({ name: row.name, quantity: String(row.quantity), note: row.note || "" })),
    budgetNote: event.budgetNote || "",
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
    if (form.endDate) {
        if (form.eventDate && form.endDate <= form.eventDate) errors.endDate = "Pick a day after the start date";
        else if (form.eventDate && (new Date(`${form.endDate}T00:00`) - new Date(`${form.eventDate}T00:00`)) / 86400000 > 7)
            errors.endDate = "An event can last at most 7 days";
    } else if (form.startTime >= form.endTime) {
        errors.endTime = "End time must be after start time — or tick “Ends on a later day”";
    }
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
    if (form.registrationForm.enabled) {
        const problem = form.registrationForm.questions.length
            ? questionProblem(form.registrationForm.questions)
            : "Add at least one question, or switch the form off";
        if (problem) errors.registrationForm = problem;
    }
    const badBudget = form.budgetItems.findIndex(
        (row) => !row.item.trim() || !(Number(row.quantity) >= 1) || !(Number(row.unitCost) >= 0) || row.unitCost === ""
    );
    if (badBudget !== -1) errors.budget = `Budget line ${badBudget + 1}: add what it's for, a quantity and a cost`;
    const badEquipment = form.equipment.findIndex((row) => !row.name.trim() || !(Number(row.quantity) >= 1));
    if (badEquipment !== -1) errors.budget = `Equipment line ${badEquipment + 1}: name the item and a quantity`;
    return errors;
};

// The steps of the form, and which fields each one holds (to point at mistakes).
const STEPS = [
    { key: "details", label: "Event details", fields: ["club", "title", "shortDescription", "description"] },
    { key: "schedule", label: "When & where", fields: ["eventDate", "endDate", "startTime", "endTime", "venue"] },
    {
        key: "registration",
        label: "Registration",
        fields: ["registrationStart", "registrationEnd", "maxParticipants", "minTeamSize", "maxTeamSize", "registrationForm"]
    },
    { key: "budget", label: "Budget & equipment", fields: ["budget"] },
    { key: "review", label: "Review", fields: [] }
];
const stepOfField = (field) => STEPS.findIndex((step) => step.fields.includes(field));
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const nextDay = (dateKey) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const bookingSummary = (venue) =>
    (venue.bookedBy || [])
        .map((booking) => `${booking.startTime}–${booking.endTime} ${booking.title}${booking.pendingApproval ? ", pending" : ""}`)
        .join("; ") || "booked";

const EventFormPage = () => {
    const { id } = useParams();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { eventClubs, reference } = useWorkspace();
    const isEdit = Boolean(id);

    const existing = useApi(() => eventApi.get(id), [id], { enabled: isEdit });

    // The planner links here with a free slot: ?date=YYYY-MM-DD&start=HH:mm&end=HH:mm.
    const [form, setForm] = useState(() => {
        const time = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "") ? value : fallback);
        return {
            ...blank,
            club: params.get("club") || "",
            eventDate: /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : "",
            startTime: time(params.get("start"), blank.startTime),
            endTime: time(params.get("end"), blank.endTime)
        };
    });
    const [touched, setTouched] = useState(false);
    const [step, setStep] = useState(0);
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
        const validSlot = form.eventDate && (form.endDate ? form.endDate > form.eventDate : form.startTime < form.endTime);
        const request = !validSlot
            ? referenceApi.venues({ status: "ACTIVE", ...audience }).then((response) => response.data.map((venue) => ({ ...venue, available: undefined })))
            : referenceApi
                  .availableVenues({
                      eventDate: form.eventDate,
                      endDate: form.endDate || undefined,
                      startTime: form.startTime,
                      endTime: form.endTime,
                      excludeEventId: id,
                      ...audience
                  })
                  .then((response) => response.data);
        request.then((list) => active && setVenues(list)).catch(() => active && setVenues(reference.venues));
        return () => {
            active = false;
        };
    }, [form.eventDate, form.endDate, form.startTime, form.endTime, form.club, audienceKey, id, reference.venues]);

    const errors = validate(form, { nowInput, isEdit, original });
    const eventStartInput = form.eventDate ? `${form.eventDate}T${form.startTime}` : undefined;
    const earliestDeadline = form.registrationStart && form.registrationStart > nowInput ? form.registrationStart : nowInput;
    const hasErrors = Object.keys(errors).length > 0;
    const selectedVenue = venues.find((venue) => venue._id === form.venue) || reference.venues.find((venue) => venue._id === form.venue);

    const set = (field) => (eventOrValue) => setForm((prev) => ({ ...prev, [field]: eventOrValue?.target ? eventOrValue.target.value : eventOrValue }));

    const toggle = (field, value) =>
        setForm((prev) => ({
            ...prev,
            [field]: prev[field].includes(value) ? prev[field].filter((item) => item !== value) : [...prev[field], value]
        }));

    // Who the event is for, to tell real clashes (same students) from events for other departments.
    const chosenClub = eventClubs.find((membership) => membership.club._id === form.club)?.club;
    const formAudience = form.departments.length
        ? form.departments
        : chosenClub && !chosenClub.allDepartments && chosenClub.departmentCodes?.length
          ? chosenClub.departmentCodes
          : "ALL";

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
            endDate: form.endDate || null,
            certificatesEnabled: form.certificatesEnabled,
            startTime: form.startTime,
            endTime: form.endTime,
            venue: form.venue,
            registrationStart: form.registrationStart ? fromDateTimeInput(form.registrationStart) : undefined,
            eligibility: { departments: form.departments, batches: form.batches, notes: form.eligibilityNotes },
            budgetItems: form.budgetItems.map((row) => ({
                item: row.item.trim(),
                quantity: Number(row.quantity),
                unitCost: Number(row.unitCost),
                note: row.note.trim()
            })),
            equipment: form.equipment.map((row) => ({ name: row.name.trim(), quantity: Number(row.quantity), note: row.note.trim() })),
            budgetNote: form.budgetNote.trim(),
            ...(isEdit ? {} : { registrationForm: registrationFormPayload() })
        };
    };
    const registrationFormPayload = () => ({
        enabled: form.registrationForm.enabled,
        questions: form.registrationForm.enabled ? toQuestionPayload(form.registrationForm.questions) : []
    });
    const formChanged = () =>
        !original ||
        JSON.stringify(registrationFormPayload()) !==
            JSON.stringify({
                enabled: original.registrationForm.enabled,
                questions: original.registrationForm.enabled ? toQuestionPayload(original.registrationForm.questions) : []
            });

    const save = async (andSubmit) => {
        setTouched(true);
        if (hasErrors) {
            // Jump to the first step with a mistake.
            const first = Math.min(
                ...Object.keys(errors)
                    .map(stepOfField)
                    .filter((index) => index >= 0)
            );
            if (Number.isFinite(first)) setStep(first);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        setPending(andSubmit ? "submit" : "save");
        setError(null);
        try {
            const body = payload();
            const response = isEdit ? await eventApi.update(id, body) : await eventApi.create(body);
            const saved = response.data;
            // The registration form isn't reviewed by the mentor, so edits to it are saved straight away.
            if (isEdit && formChanged()) await eventApi.updateRegistrationForm(id, registrationFormPayload());
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
                    message:
                        new Date(event.startAt) <= new Date()
                            ? "This event has already started, so its details can no longer be changed."
                            : "This event can no longer be edited."
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
    const stepProblems = Object.fromEntries(STEPS.map((item) => [item.key, touched && item.fields.some((field) => errors[field])]));
    const goTo = (index) => {
        setStep(index);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const next = () => {
        const fields = STEPS[step].fields;
        if (fields.some((field) => errors[field])) {
            setTouched(true);
            return;
        }
        goTo(step + 1);
    };
    const setRegForm = (patch) => setForm((prev) => ({ ...prev, registrationForm: { ...prev.registrationForm, ...patch } }));
    const setRow = (list, index, patch) => setForm((prev) => ({ ...prev, [list]: prev[list].map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
    const budgetTotal = form.budgetItems.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unitCost) || 0), 0);

    return (
        <AsyncContent loading={isEdit && existing.loading}>
            <WizardHeader
                eyebrow={isEdit ? "Edit event" : "Create event"}
                title={isEdit ? event?.title || "Edit event" : "Plan your event"}
                back={
                    <PageHeader back={isEdit ? { to: `/events/${id}`, label: "Back to event" } : { to: "/events/manage", label: "Manage events" }} title="" />
                }
            />

            <div className="wiz stack-lg">
                {mode === "live" && (
                    <Alert type="info">
                        Your faculty mentor reviews the changes first — students see the current details until they're approved and published.
                    </Alert>
                )}
                {mode === "reapprove" && <Alert type="info">Saving changes sends this event back to your faculty mentor for approval.</Alert>}
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

                <Stepper steps={STEPS} current={step} reached={STEPS.length - 1} onStep={goTo} problems={stepProblems} />

                {step === 0 && (
                    <>
                        <FormSection title="Event details" description="What it is and who runs it. Students see this on the event page and in the feed.">
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
                                <Input
                                    className="span-2"
                                    label="Title"
                                    value={form.title}
                                    onChange={set("title")}
                                    maxLength={160}
                                    error={fieldError("title")}
                                    required
                                />
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
                                {form.category === "HACKATHON" && (
                                    <div className="span-2">
                                        <Alert type="info" title="Hackathon tools are on">
                                            After saving, open the event's <strong>Hackathon hub</strong> to add problem statements (released to teams when the
                                            event starts), the problem selection and submission deadlines, the agenda and the judges. Teams register first and
                                            pick a problem later, like a real hackathon.
                                        </Alert>
                                    </div>
                                )}
                            </div>
                        </FormSection>

                        <FormSection title="Rules & contact" description="Guidelines for participants and who to ask.">
                            <div className="form-grid">
                                <Textarea className="span-2" label="Rules & guidelines" value={form.rules} onChange={set("rules")} rows={5} maxLength={8000} />
                                <Input label="Contact person" value={form.contactName} onChange={set("contactName")} maxLength={120} />
                                <Input label="Contact email" type="email" value={form.contactEmail} onChange={set("contactEmail")} />
                                <Input label="Contact phone" type="tel" value={form.contactPhone} onChange={set("contactPhone")} maxLength={30} />
                            </div>
                        </FormSection>
                    </>
                )}
                {step === 1 && (
                    <FormSection
                        title="When & where"
                        description="Pick the date, time and venue. Busy venues and clashes with other events are shown as you go."
                    >
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
                                <Input
                                    label="Ends"
                                    type="time"
                                    value={form.endTime}
                                    onChange={set("endTime")}
                                    error={scheduleError("endTime", form.eventDate)}
                                    required
                                />
                            </div>
                            <div className="span-2 multi-day-row">
                                <Checkbox
                                    label="Ends on a later day (overnight or multi-day event)"
                                    checked={Boolean(form.endDate)}
                                    onChange={(e) => set("endDate")(e.target.checked ? nextDay(form.eventDate || today) : "")}
                                />
                                {form.endDate && (
                                    <Input
                                        label="End date"
                                        type="date"
                                        min={form.eventDate || today}
                                        value={form.endDate}
                                        onChange={set("endDate")}
                                        error={scheduleError("endDate", form.endDate)}
                                        required
                                    />
                                )}
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
                            {form.eventDate && (
                                <div className="span-2">
                                    <ScheduleCheck
                                        dateKey={form.eventDate}
                                        endDate={form.endDate}
                                        startTime={form.startTime}
                                        endTime={form.endTime}
                                        audience={formAudience}
                                        excludeId={id}
                                        embedded
                                    />
                                </div>
                            )}
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
                    </FormSection>
                )}
                {step === 2 && (
                    <>
                        <FormSection title="Registration" description="When registration opens and closes, how many can join, and who is eligible.">
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
                                            {
                                                value: "INDIVIDUAL",
                                                label: (
                                                    <>
                                                        <User size={14} /> Individuals
                                                    </>
                                                )
                                            },
                                            {
                                                value: "TEAM",
                                                label: (
                                                    <>
                                                        <Users size={14} /> Teams
                                                    </>
                                                )
                                            }
                                        ]}
                                    />
                                </Field>
                                {isTeam && (
                                    <div className="grid-2" style={{ gap: 12 }}>
                                        <Input
                                            label="Minimum team size"
                                            type="number"
                                            min={1}
                                            max={20}
                                            value={form.minTeamSize}
                                            onChange={set("minTeamSize")}
                                            disabled={hasEntries}
                                            error={fieldError("minTeamSize")}
                                            hint="Including the leader"
                                        />
                                        <Input
                                            label="Maximum team size"
                                            type="number"
                                            min={2}
                                            max={20}
                                            value={form.maxTeamSize}
                                            onChange={set("maxTeamSize")}
                                            disabled={hasEntries}
                                            error={fieldError("maxTeamSize")}
                                        />
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
                                <Input
                                    label="Eligibility notes"
                                    value={form.eligibilityNotes}
                                    onChange={set("eligibilityNotes")}
                                    placeholder="e.g. Bring a student ID"
                                    maxLength={1000}
                                />
                            </div>
                        </FormSection>

                        <FormSection
                            title="Registration form"
                            description="Students' name, email, department, batch and phone come from their account. Add a form only if you need anything else."
                            aside={<ClipboardList size={20} className="subtle" />}
                        >
                            <div className="stack">
                                <Switch
                                    checked={form.registrationForm.enabled}
                                    onChange={(enabled) => setRegForm({ enabled })}
                                    label="Ask extra questions when students register"
                                    description={
                                        isTeam
                                            ? "For team events, choose for each question whether the leader answers once for the team or every member answers."
                                            : "e.g. T-shirt size, food preference, portfolio link."
                                    }
                                />
                                {form.registrationForm.enabled && (
                                    <QuestionBuilder
                                        questions={form.registrationForm.questions}
                                        onChange={(questions) => setRegForm({ questions })}
                                        withScope={isTeam}
                                        emptyHint="Add the first question."
                                    />
                                )}
                                {fieldError("registrationForm") && <Alert type="error">{fieldError("registrationForm")}</Alert>}
                            </div>
                        </FormSection>
                        <FormSection title="Certificates" description="Optional — for checked-in students and winners.">
                            <Switch
                                checked={form.certificatesEnabled}
                                onChange={set("certificatesEnabled")}
                                label="Give certificates"
                                description="Participation certificates for students checked in at the event, and merit certificates for the winners once results are published. Students download them from the event page; each has a QR code anyone can verify."
                            />
                        </FormSection>
                    </>
                )}
                {step === 3 && (
                    <>
                        <FormSection
                            title="Budget"
                            description="What the event will cost. Your faculty mentor approves it together with the event. Only the club, the mentor and the admin see it."
                            aside={<span className="budget-total">{money(budgetTotal)}</span>}
                        >
                            <div className="stack">
                                {form.budgetItems.map((row, index) => (
                                    <div key={index} className="budget-row">
                                        <Input
                                            label="Item"
                                            value={row.item}
                                            onChange={(e) => setRow("budgetItems", index, { item: e.target.value })}
                                            placeholder="e.g. Prizes, snacks, printing"
                                            maxLength={120}
                                        />
                                        <Input
                                            label="Qty"
                                            type="number"
                                            min={1}
                                            value={row.quantity}
                                            onChange={(e) => setRow("budgetItems", index, { quantity: e.target.value })}
                                        />
                                        <Input
                                            label="Cost each (₹)"
                                            type="number"
                                            min={0}
                                            value={row.unitCost}
                                            onChange={(e) => setRow("budgetItems", index, { unitCost: e.target.value })}
                                        />
                                        <span className="budget-line-total">{money((Number(row.quantity) || 0) * (Number(row.unitCost) || 0))}</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setForm((prev) => ({ ...prev, budgetItems: prev.budgetItems.filter((_, i) => i !== index) }))}
                                            aria-label={`Remove budget line ${index + 1}`}
                                        >
                                            <Trash2 size={15} />
                                        </Button>
                                    </div>
                                ))}
                                <div className="row">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() =>
                                            setForm((prev) => ({
                                                ...prev,
                                                budgetItems: [...prev.budgetItems, { item: "", quantity: "1", unitCost: "", note: "" }]
                                            }))
                                        }
                                        disabled={form.budgetItems.length >= 40}
                                    >
                                        <Plus size={14} /> Add budget line
                                    </Button>
                                    {!form.budgetItems.length && <span className="subtle small">No budget needed? Leave it empty.</span>}
                                </div>
                                <Textarea
                                    label="Notes for your mentor (optional)"
                                    value={form.budgetNote}
                                    onChange={set("budgetNote")}
                                    rows={2}
                                    maxLength={1000}
                                    placeholder="Sponsors, how it will be paid, anything to explain"
                                />
                            </div>
                        </FormSection>

                        <FormSection
                            title="Equipment"
                            description="Things you need from the university on the day — projector, microphones, chairs, extension boards…"
                        >
                            <div className="stack">
                                {form.equipment.map((row, index) => (
                                    <div key={index} className="equipment-row">
                                        <Input
                                            label="Item"
                                            value={row.name}
                                            onChange={(e) => setRow("equipment", index, { name: e.target.value })}
                                            placeholder="e.g. Projector"
                                            maxLength={120}
                                        />
                                        <Input
                                            label="Qty"
                                            type="number"
                                            min={1}
                                            value={row.quantity}
                                            onChange={(e) => setRow("equipment", index, { quantity: e.target.value })}
                                        />
                                        <Input
                                            label="Note"
                                            value={row.note}
                                            onChange={(e) => setRow("equipment", index, { note: e.target.value })}
                                            placeholder="optional"
                                            maxLength={200}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setForm((prev) => ({ ...prev, equipment: prev.equipment.filter((_, i) => i !== index) }))}
                                            aria-label={`Remove equipment line ${index + 1}`}
                                        >
                                            <Trash2 size={15} />
                                        </Button>
                                    </div>
                                ))}
                                <div className="row">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setForm((prev) => ({ ...prev, equipment: [...prev.equipment, { name: "", quantity: "1", note: "" }] }))}
                                        disabled={form.equipment.length >= 40}
                                    >
                                        <Plus size={14} /> Add equipment
                                    </Button>
                                </div>
                                {fieldError("budget") && <Alert type="error">{fieldError("budget")}</Alert>}
                            </div>
                        </FormSection>
                    </>
                )}
                {step === 4 && (
                    <>
                        <FormSection title="Review" description="Check everything before you save. You can go back to any step.">
                            <dl className="review-list">
                                {[
                                    ["Event", form.title || "—", 0],
                                    ["Club", clubOptions.find((option) => option.value === form.club)?.label || "—", 0],
                                    [
                                        "When",
                                        form.eventDate
                                            ? `${form.eventDate}${form.endDate ? ` → ${form.endDate}` : ""} · ${form.startTime}–${form.endTime}`
                                            : "—",
                                        1
                                    ],
                                    ["Venue", selectedVenue ? `${selectedVenue.name}, ${selectedVenue.location}` : "—", 1],
                                    [
                                        "Registration",
                                        `${isTeam ? `Teams of ${form.minTeamSize}–${form.maxTeamSize}` : "Individuals"} · closes ${form.registrationEnd ? form.registrationEnd.replace("T", " ") : "—"}${form.maxParticipants ? ` · limit ${form.maxParticipants}` : ""}`,
                                        2
                                    ],
                                    [
                                        "Registration form",
                                        form.registrationForm.enabled
                                            ? `${form.registrationForm.questions.length} question${form.registrationForm.questions.length === 1 ? "" : "s"}`
                                            : "No extra questions",
                                        2
                                    ],
                                    ["Certificates", form.certificatesEnabled ? "Yes" : "No", 2],
                                    [
                                        "Budget",
                                        form.budgetItems.length
                                            ? `${money(budgetTotal)} · ${form.budgetItems.length} line${form.budgetItems.length === 1 ? "" : "s"}`
                                            : "None",
                                        3
                                    ],
                                    ["Equipment", form.equipment.length ? form.equipment.map((row) => `${row.quantity}× ${row.name}`).join(", ") : "None", 3]
                                ].map(([label, value, stepIndex]) => (
                                    <div key={label} className={stepProblems[STEPS[stepIndex].key] ? "has-problem" : ""}>
                                        <dt>{label}</dt>
                                        <dd>{value}</dd>
                                        <button type="button" className="link-button small" onClick={() => goTo(stepIndex)}>
                                            Edit
                                        </button>
                                    </div>
                                ))}
                            </dl>
                        </FormSection>
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
                    </>
                )}

                <WizardNav
                    current={step}
                    total={STEPS.length}
                    onBack={() => goTo(step - 1)}
                    onNext={next}
                    nextLabel={step === STEPS.length - 2 ? "Review" : "Continue"}
                    final={
                        <>
                            {editableStatus && (
                                <Button variant="secondary" onClick={() => save(false)} loading={pending === "save"} disabled={Boolean(pending)}>
                                    <Save size={16} /> Save draft
                                </Button>
                            )}
                            {editableStatus ? (
                                <Button onClick={() => save(true)} loading={pending === "submit"} disabled={Boolean(pending)}>
                                    <Send size={16} /> Submit for approval
                                </Button>
                            ) : (
                                <Button onClick={() => save(false)} loading={pending === "save"} disabled={Boolean(pending)}>
                                    <Send size={16} /> {mode === "reapprove" ? "Save & send for approval" : "Send changes for approval"}
                                </Button>
                            )}
                        </>
                    }
                />
            </div>
        </AsyncContent>
    );
};

export default EventFormPage;
