import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Copy, GripVertical, ListChecks, Megaphone, Plus, Save, Send, Trash2, UserRoundPlus } from "lucide-react";
import { recruitmentApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Button, Card, Checkbox, Field, Input, PageHeader, Select, Switch, Textarea } from "../../components/ui";
import { ASSIGNABLE_CLUB_ROLES, CLUB_ROLE_DESCRIPTIONS, QUESTION_TYPES } from "../../lib/constants";
import { batchLabel, fromDateTimeInput, humanize, toDateTimeInput } from "../../lib/format";
import { QuestionPreview } from "../../components/recruitment/QuestionPreview";

const CHOICE = ["SINGLE_CHOICE", "MULTI_CHOICE"];
let keySeed = 0;
const key = () => `k${(keySeed += 1)}`;

const blankQuestion = (type = "SHORT") => ({ key: key(), type, label: "", help: "", required: false, options: CHOICE.includes(type) ? ["", ""] : [] });

// A sensible starting form; the president edits or removes anything.
const STARTER_QUESTIONS = [
    { key: key(), type: "PARAGRAPH", label: "Why do you want to join the club?", help: "", required: true, options: [] },
    { key: key(), type: "SINGLE_CHOICE", label: "How much time can you give each week?", help: "", required: true, options: ["2–4 hours", "4–6 hours", "6+ hours"] },
    { key: key(), type: "LINK", label: "Portfolio, GitHub or LinkedIn", help: "Optional", required: false, options: [] }
];

const inDays = (days) => toDateTimeInput(new Date(Date.now() + days * 86400000));

const fromDrive = (drive) => ({
    title: drive.title,
    description: drive.description,
    applicationStart: toDateTimeInput(drive.applicationStart),
    applicationEnd: toDateTimeInput(drive.applicationEnd),
    batches: drive.eligibility?.batches || [],
    positions: drive.positions.map((position) => ({ ...position, key: position._id, openings: position.openings ?? "" })),
    questions: drive.questions.map((question) => ({ ...question, key: question._id, options: question.options?.length ? question.options : CHOICE.includes(question.type) ? ["", ""] : [] }))
});

const emptyForm = () => ({
    title: "",
    description: "",
    applicationStart: toDateTimeInput(new Date()),
    applicationEnd: inDays(7),
    batches: [],
    positions: [{ key: key(), role: "MEMBER", title: "Member", openings: "", description: "" }],
    questions: STARTER_QUESTIONS.map((question) => ({ ...question, key: key() }))
});

const validate = (form) => {
    const errors = {};
    if (!form.title.trim()) errors.title = "Give the drive a title";
    if (!form.description.trim()) errors.description = "Tell students what you're looking for";
    if (!form.applicationEnd) errors.applicationEnd = "Set the deadline";
    else if (fromDateTimeInput(form.applicationEnd) <= new Date().toISOString()) errors.applicationEnd = "The deadline must be in the future";
    else if (form.applicationStart && form.applicationStart >= form.applicationEnd) errors.applicationEnd = "Applications must close after they open";
    if (!form.positions.length) errors.positions = "Add at least one position";
    form.positions.forEach((position, index) => {
        if (!position.title.trim()) errors[`position-${index}`] = "Name this position";
    });
    form.questions.forEach((question, index) => {
        if (!question.label.trim()) errors[`question-${index}`] = "Write the question";
        else if (CHOICE.includes(question.type) && question.options.filter((option) => option.trim()).length < 2) errors[`question-${index}`] = "Add at least two options";
    });
    return errors;
};

const toPayload = (form) => ({
    title: form.title.trim(),
    description: form.description.trim(),
    applicationStart: form.applicationStart ? fromDateTimeInput(form.applicationStart) : undefined,
    applicationEnd: fromDateTimeInput(form.applicationEnd),
    eligibility: { batches: form.batches },
    positions: form.positions.map(({ key: _key, ...position }) => ({ ...position, openings: position.openings === "" ? null : Number(position.openings) })),
    questions: form.questions.map(({ key: _key, ...question }) => ({ ...question, options: CHOICE.includes(question.type) ? question.options.map((option) => option.trim()).filter(Boolean) : [] }))
});

// ---------------------------------------------------------------- Positions

const PositionsEditor = ({ positions, onChange, errors }) => {
    const update = (index, changes) => onChange(positions.map((position, i) => (i === index ? { ...position, ...changes } : position)));
    const add = () => onChange([...positions, { key: key(), role: "MEMBER", title: "", openings: "", description: "" }]);

    return (
        <div className="stack">
            {positions.map((position, index) => (
                <div key={position.key} className="recruit-position-row">
                    <Input label="Position title" value={position.title} onChange={(event) => update(index, { title: event.target.value })} placeholder="e.g. Design lead" maxLength={60} error={errors[`position-${index}`]} required />
                    <Select
                        label="Club role when selected"
                        value={position.role}
                        onChange={(event) => update(index, { role: event.target.value, title: position.title || humanize(event.target.value) })}
                        options={ASSIGNABLE_CLUB_ROLES.map((role) => ({ value: role, label: humanize(role) }))}
                        hint={CLUB_ROLE_DESCRIPTIONS[position.role]}
                    />
                    <Input label="Openings" type="number" min={1} max={500} value={position.openings} onChange={(event) => update(index, { openings: event.target.value })} placeholder="Any" />
                    <Button
                        variant="ghost"
                        size="sm"
                        className="recruit-remove"
                        onClick={() => onChange(positions.filter((_, i) => i !== index))}
                        disabled={positions.length === 1}
                        aria-label={`Remove ${position.title || "position"}`}
                    >
                        <Trash2 size={15} />
                    </Button>
                    <Input
                        className="recruit-position-desc"
                        label="What they'll do (optional)"
                        value={position.description}
                        onChange={(event) => update(index, { description: event.target.value })}
                        maxLength={400}
                    />
                </div>
            ))}
            {errors.positions && <span className="field-error">{errors.positions}</span>}
            {positions.length < 10 && (
                <Button variant="secondary" size="sm" onClick={add}>
                    <Plus size={15} /> Add position
                </Button>
            )}
        </div>
    );
};

// ---------------------------------------------------------------- Questions

const QuestionEditor = ({ question, index, count, onChange, onMove, onRemove, onDuplicate, error }) => {
    const setOptions = (options) => onChange({ ...question, options });
    return (
        <div className={`recruit-question ${error ? "has-error" : ""}`} style={{ "--i": index }}>
            <div className="recruit-question-head">
                <span className="recruit-question-num">
                    <GripVertical size={14} /> Q{index + 1}
                </span>
                <div className="row" style={{ gap: 4 }}>
                    <Button variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
                        <ArrowUp size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">
                        <ArrowDown size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onDuplicate} aria-label="Duplicate question">
                        <Copy size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Delete question">
                        <Trash2 size={15} />
                    </Button>
                </div>
            </div>
            <div className="recruit-question-grid">
                <Input label="Question" value={question.label} onChange={(event) => onChange({ ...question, label: event.target.value })} placeholder="Ask something" maxLength={200} error={error} required />
                <Select
                    label="Answer type"
                    value={question.type}
                    onChange={(event) => {
                        const type = event.target.value;
                        onChange({ ...question, type, options: CHOICE.includes(type) ? (question.options.length >= 2 ? question.options : ["", ""]) : [] });
                    }}
                    options={QUESTION_TYPES}
                />
            </div>
            <Input label="Help text (optional)" value={question.help} onChange={(event) => onChange({ ...question, help: event.target.value })} maxLength={300} placeholder="Shown under the question" />
            {CHOICE.includes(question.type) && (
                <Field label="Options">
                    <div className="recruit-options">
                        {question.options.map((option, optionIndex) => (
                            <div key={optionIndex} className="recruit-option">
                                <span className={question.type === "SINGLE_CHOICE" ? "recruit-radio" : "recruit-box"} aria-hidden="true" />
                                <input
                                    className="input"
                                    value={option}
                                    onChange={(event) => setOptions(question.options.map((item, i) => (i === optionIndex ? event.target.value : item)))}
                                    placeholder={`Option ${optionIndex + 1}`}
                                    maxLength={100}
                                    aria-label={`Option ${optionIndex + 1}`}
                                />
                                <Button variant="ghost" size="sm" onClick={() => setOptions(question.options.filter((_, i) => i !== optionIndex))} disabled={question.options.length <= 2} aria-label={`Remove option ${optionIndex + 1}`}>
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        ))}
                        {question.options.length < 12 && (
                            <Button variant="ghost" size="sm" onClick={() => setOptions([...question.options, ""])}>
                                <Plus size={14} /> Add option
                            </Button>
                        )}
                    </div>
                </Field>
            )}
            <Switch checked={question.required} onChange={(required) => onChange({ ...question, required })} label="Required" description="Students can't submit without answering" />
        </div>
    );
};

const QuestionBuilder = ({ questions, onChange, errors }) => {
    const update = (index, next) => onChange(questions.map((question, i) => (i === index ? next : question)));
    const move = (index, step) => {
        const next = [...questions];
        const [item] = next.splice(index, 1);
        next.splice(index + step, 0, item);
        onChange(next);
    };
    return (
        <div className="stack">
            <p className="subtle small" style={{ margin: 0 }}>
                The student's name, email, department and batch are filled in automatically — only ask for what you need.
            </p>
            {questions.map((question, index) => (
                <QuestionEditor
                    key={question.key}
                    question={question}
                    index={index}
                    count={questions.length}
                    error={errors[`question-${index}`]}
                    onChange={(next) => update(index, next)}
                    onMove={(step) => move(index, step)}
                    onRemove={() => onChange(questions.filter((_, i) => i !== index))}
                    onDuplicate={() => onChange([...questions.slice(0, index + 1), { ...question, key: key(), _id: undefined }, ...questions.slice(index + 1)])}
                />
            ))}
            {questions.length < 20 && (
                <div className="recruit-add-question">
                    {QUESTION_TYPES.map((type) => (
                        <Button key={type.value} variant="secondary" size="sm" onClick={() => onChange([...questions, blankQuestion(type.value)])}>
                            <Plus size={14} /> {type.label}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
};

// ---------------------------------------------------------------- Page

/** Create (/clubs/:id/recruitment/new) or edit (/recruitment/:id/edit) a recruitment drive. */
const DriveFormPage = () => {
    const { id: clubId, driveId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const isEdit = Boolean(driveId);
    const existing = useApi(() => recruitmentApi.get(driveId), [driveId], { enabled: isEdit });
    const batches = useApi(() => referenceApi.batches(), []);
    const [form, setForm] = useState(emptyForm);
    const [touched, setTouched] = useState(false);
    const [saving, setSaving] = useState(null);
    const [preview, setPreview] = useState(false);

    useEffect(() => {
        if (existing.data) {
            setForm(fromDrive(existing.data));
        }
    }, [existing.data]);

    const errors = useMemo(() => validate(form), [form]);
    const shown = touched ? errors : {};
    const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
    const toggleBatch = (code) => setForm((current) => ({ ...current, batches: current.batches.includes(code) ? current.batches.filter((item) => item !== code) : [...current.batches, code] }));

    const save = async (andSubmit) => {
        setTouched(true);
        if (Object.keys(errors).length) {
            toast.error("Please fix the highlighted fields");
            return;
        }
        setSaving(andSubmit ? "submit" : "save");
        try {
            const response = isEdit ? await recruitmentApi.update(driveId, toPayload(form)) : await recruitmentApi.create(clubId, toPayload(form));
            const id = response.data._id;
            if (andSubmit) {
                await recruitmentApi.submit(id);
                toast.success("Sent to your faculty mentor for approval");
            } else {
                toast.success("Draft saved");
            }
            navigate(`/recruitment/${id}`);
        } catch (error) {
            toast.error(error);
        } finally {
            setSaving(null);
        }
    };

    const club = existing.data?.club;
    const locked = isEdit && existing.data && !existing.data.viewer?.canEdit;

    return (
        <AsyncContent loading={isEdit && existing.loading} error={existing.error} onRetry={existing.reload}>
            <PageHeader
                back={{ to: isEdit ? `/recruitment/${driveId}` : `/clubs/${clubId}/recruitment`, label: isEdit ? "Back to the drive" : "Recruitment" }}
                eyebrow={
                    <>
                        <Megaphone size={14} /> {club ? club.name : "Recruitment"}
                    </>
                }
                title={isEdit ? "Edit recruitment drive" : "New recruitment drive"}
                description="Set the positions and the application form. Your faculty mentor approves it before students can apply."
            />
            {locked ? (
                <Alert type="warning" title="This drive can't be edited now">
                    Drives can be changed while they're drafts or when your mentor asks for changes.
                </Alert>
            ) : (
                <div className="recruit-form">
                    <div className="stack-lg">
                        <Card title="About the drive">
                            <div className="form-grid">
                                <Input className="span-2" label="Title" value={form.title} onChange={set("title")} placeholder="e.g. Core team recruitment 2026–27" maxLength={120} error={shown.title} required />
                                <Textarea
                                    className="span-2"
                                    label="What you're looking for"
                                    value={form.description}
                                    onChange={set("description")}
                                    rows={5}
                                    maxLength={4000}
                                    placeholder="Who should apply, what members do, how selection works…"
                                    error={shown.description}
                                    required
                                />
                                <Input label="Applications open" type="datetime-local" value={form.applicationStart} onChange={set("applicationStart")} hint="Leave as now to open when published" />
                                <Input label="Application deadline" type="datetime-local" value={form.applicationEnd} onChange={set("applicationEnd")} error={shown.applicationEnd} required />
                                <Field className="span-2" label="Batches" hint="Students from your club's departments can apply. Leave all unchecked for every batch.">
                                    <div className="row">
                                        {(batches.data || []).map((batch) => (
                                            <Checkbox key={batch._id} label={batchLabel(batch.code)} checked={form.batches.includes(batch.code)} onChange={() => toggleBatch(batch.code)} />
                                        ))}
                                    </div>
                                </Field>
                            </div>
                        </Card>

                        <Card title={<h2 className="row"><UserRoundPlus size={18} /> Open positions</h2>}>
                            <PositionsEditor positions={form.positions} onChange={(positions) => setForm((current) => ({ ...current, positions }))} errors={shown} />
                        </Card>

                        <Card
                            title={<h2 className="row"><ListChecks size={18} /> Application form</h2>}
                            actions={
                                <Button variant="ghost" size="sm" onClick={() => setPreview((value) => !value)}>
                                    {preview ? "Edit questions" : "Preview"}
                                </Button>
                            }
                        >
                            {preview ? (
                                <div className="stack">
                                    {form.questions.length ? form.questions.map((question) => <QuestionPreview key={question.key} question={question} />) : <p className="subtle">No questions — students only choose positions.</p>}
                                </div>
                            ) : (
                                <QuestionBuilder questions={form.questions} onChange={(questions) => setForm((current) => ({ ...current, questions }))} errors={shown} />
                            )}
                        </Card>

                        <div className="form-actions">
                            <Button variant="secondary" onClick={() => save(false)} loading={saving === "save"} disabled={Boolean(saving)}>
                                <Save size={16} /> Save draft
                            </Button>
                            <Button onClick={() => save(true)} loading={saving === "submit"} disabled={Boolean(saving)}>
                                <Send size={16} /> Save and send for approval
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </AsyncContent>
    );
};

export default DriveFormPage;
