import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlignLeft, ArrowDown, ArrowUp, CircleDot, Copy, FileText, Layers, Link2, Paperclip, Plus, Save, Send, SquareCheck, Trash2, Type, UserRoundPlus, X } from "lucide-react";
import { clubApi, recruitmentApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Alert, AsyncContent, Button, Card, Checkbox, Field, Input, PageHeader, Segmented, Select, Switch, Textarea } from "../../components/ui";
import { QUESTION_TYPES } from "../../lib/constants";
import { batchLabel, fromDateTimeInput, plural, toDateTimeInput } from "../../lib/format";
import { QuestionPreview } from "../../components/recruitment/QuestionPreview";

const CHOICE = ["SINGLE_CHOICE", "MULTI_CHOICE"];
const MAX_PAGES = 8;
const MAX_QUESTIONS_PER_PAGE = 20;
let keySeed = 0;
const key = () => `k${(keySeed += 1)}`;

const blankQuestion = (type = "SHORT") => ({ key: key(), type, label: "", help: "", required: false, options: CHOICE.includes(type) ? ["", ""] : [] });
const blankPage = (number) => ({ key: key(), title: number === 1 ? "About you" : `Page ${number}`, description: "", questions: [] });

// A sensible starting form for a new role; the president edits or removes anything.
const starterPages = (roleName) => [
    {
        key: key(),
        title: "About you",
        description: "",
        questions: [
            { key: key(), type: "PARAGRAPH", label: `Why do you want to be ${roleName}?`, help: "", required: true, options: [] },
            { key: key(), type: "SINGLE_CHOICE", label: "How much time can you give each week?", help: "", required: true, options: ["2–4 hours", "4–6 hours", "6+ hours"] }
        ]
    },
    {
        key: key(),
        title: "Experience",
        description: "",
        questions: [{ key: key(), type: "LINK", label: "Portfolio, GitHub or LinkedIn", help: "Optional", required: false, options: [] }]
    }
];

// Fresh keys and no ids, so a copied form is independent of the one it came from.
const clonePages = (pages) =>
    pages.map((page) => ({
        ...page,
        key: key(),
        _id: undefined,
        questions: page.questions.map((question) => ({ ...question, key: key(), _id: undefined, options: [...question.options] }))
    }));

const inDays = (days) => toDateTimeInput(new Date(Date.now() + days * 86400000));

const fromDrive = (drive) => ({
    title: drive.title,
    description: drive.description,
    applicationStart: toDateTimeInput(drive.applicationStart),
    applicationEnd: toDateTimeInput(drive.applicationEnd),
    batches: drive.eligibility?.batches || [],
    positions: drive.positions.map((position) => ({
        _id: position._id,
        key: position._id,
        role: position.role,
        title: position.title,
        openings: position.openings ?? "",
        description: position.description || "",
        pages: (position.form?.pages || []).map((page) => ({
            ...page,
            key: page._id,
            description: page.description || "",
            questions: page.questions.map((question) => ({ ...question, key: question._id, help: question.help || "", options: question.options?.length ? question.options : CHOICE.includes(question.type) ? ["", ""] : [] }))
        }))
    }))
});

const emptyForm = () => ({
    title: "",
    description: "",
    applicationStart: toDateTimeInput(new Date()),
    applicationEnd: inDays(7),
    batches: [],
    positions: []
});

const validate = (form) => {
    const errors = {};
    if (!form.title.trim()) errors.title = "Give the drive a title";
    if (!form.description.trim()) errors.description = "Tell students what you're looking for";
    if (!form.applicationEnd) errors.applicationEnd = "Set the deadline";
    else if (fromDateTimeInput(form.applicationEnd) <= new Date().toISOString()) errors.applicationEnd = "The deadline must be in the future";
    else if (form.applicationStart && form.applicationStart >= form.applicationEnd) errors.applicationEnd = "Applications must close after they open";
    if (!form.positions.length) errors.positions = "Choose at least one role you're recruiting for";
    form.positions.forEach((position, p) => {
        position.pages.forEach((page, g) => {
            if (!page.title.trim()) errors[`${p}.${g}`] = "Give this page a title";
            page.questions.forEach((question, q) => {
                if (!question.label.trim()) errors[`${p}.${g}.${q}`] = "Write the question";
                else if (CHOICE.includes(question.type) && question.options.filter((option) => option.trim()).length < 2) errors[`${p}.${g}.${q}`] = "Add at least two options";
            });
        });
    });
    return errors;
};

// How many problems each role has, for the dot on its tab.
const problemsIn = (errors, index) => Object.keys(errors).filter((name) => name.startsWith(`${index}.`)).length;

const toPayload = (form) => ({
    title: form.title.trim(),
    description: form.description.trim(),
    applicationStart: form.applicationStart ? fromDateTimeInput(form.applicationStart) : undefined,
    applicationEnd: fromDateTimeInput(form.applicationEnd),
    eligibility: { batches: form.batches },
    positions: form.positions.map((position) => ({
        ...(position._id ? { _id: position._id } : {}),
        role: position.role,
        openings: position.openings === "" ? null : Number(position.openings),
        description: position.description.trim(),
        form: {
            pages: position.pages.map((page) => ({
                ...(page._id ? { _id: page._id } : {}),
                title: page.title.trim(),
                description: page.description.trim(),
                questions: page.questions.map(({ key: _key, ...question }) => ({
                    ...question,
                    options: CHOICE.includes(question.type) ? question.options.map((option) => option.trim()).filter(Boolean) : []
                }))
            }))
        }
    }))
});

// ---------------------------------------------------------------- Questions

const TYPE_LABEL = Object.fromEntries(QUESTION_TYPES.map((type) => [type.value, type.label]));
const TYPE_ICON = { SHORT: Type, PARAGRAPH: AlignLeft, SINGLE_CHOICE: CircleDot, MULTI_CHOICE: SquareCheck, LINK: Link2, FILE: Paperclip };

// Move / duplicate / delete for a question, folded into one "⋯" menu.
const questionMenu = ({ index, count, onMove, onDuplicate, onRemove }) => [
    { label: "Move up", icon: ArrowUp, onClick: () => onMove(-1), disabled: index === 0 },
    { label: "Move down", icon: ArrowDown, onClick: () => onMove(1), disabled: index === count - 1 },
    { label: "Duplicate", icon: Copy, onClick: onDuplicate },
    "divider",
    { label: "Delete question", icon: Trash2, onClick: onRemove, danger: true }
];

/**
 * One question. Only the question being worked on opens in full; the others show as a compact row,
 * so a long form stays easy to scan. Click a row to edit it.
 */
const QuestionEditor = ({ question, index, count, active, onActivate, onChange, onMove, onRemove, onDuplicate, error }) => {
    const setOptions = (options) => onChange({ ...question, options });
    const Icon = TYPE_ICON[question.type] || Type;
    const menu = <ActionMenu label={`Question ${index + 1} actions`} items={questionMenu({ index, count, onMove, onDuplicate, onRemove })} />;

    if (!active) {
        return (
            <div className={`recruit-q-row ${error ? "has-error" : ""}`} style={{ "--i": index }}>
                <button type="button" className="recruit-q-row-main" onClick={onActivate} aria-label={`Edit question ${index + 1}: ${question.label || "untitled"}`}>
                    <span className="recruit-q-icon">
                        <Icon size={15} />
                    </span>
                    <span className="recruit-q-text">
                        <strong>
                            {question.label || <span className="subtle">Untitled question</span>}
                            {question.required && <span className="req"> *</span>}
                        </strong>
                        <span className="subtle small">{error || TYPE_LABEL[question.type]}</span>
                    </span>
                </button>
                {menu}
            </div>
        );
    }

    return (
        <div className={`recruit-question ${error ? "has-error" : ""}`}>
            <div className="recruit-question-head">
                <span className="recruit-question-num">
                    <Icon size={14} /> Question {index + 1}
                </span>
                {menu}
            </div>
            <div className="recruit-question-grid">
                <Input label="Question" value={question.label} onChange={(event) => onChange({ ...question, label: event.target.value })} placeholder="Ask something" maxLength={200} error={error} autoFocus={!question.label} required />
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
                                    onKeyDown={(event) => {
                                        // Enter on the last option adds the next one, like a list in a doc.
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            if (optionIndex === question.options.length - 1 && question.options.length < 12) setOptions([...question.options, ""]);
                                        }
                                    }}
                                    placeholder={`Option ${optionIndex + 1}`}
                                    maxLength={100}
                                    aria-label={`Option ${optionIndex + 1}`}
                                />
                                {question.options.length > 2 && (
                                    <button type="button" className="recruit-option-remove" onClick={() => setOptions(question.options.filter((_, i) => i !== optionIndex))} aria-label={`Remove option ${optionIndex + 1}`}>
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {question.options.length < 12 && (
                            <button type="button" className="recruit-option-add" onClick={() => setOptions([...question.options, ""])}>
                                <Plus size={14} /> Add option
                            </button>
                        )}
                    </div>
                </Field>
            )}
            <Switch checked={question.required} onChange={(required) => onChange({ ...question, required })} label="Required" description="Students can't continue without answering" />
        </div>
    );
};

// "Add question" opens a menu of answer types instead of six buttons.
const AddQuestion = ({ onAdd }) => (
    <ActionMenu
        align="left"
        label="Add a question"
        items={QUESTION_TYPES.map((type) => ({ label: type.label, icon: TYPE_ICON[type.value], onClick: () => onAdd(type.value) }))}
        trigger={({ open, toggle, menuId }) => (
            <button type="button" className="recruit-add-q" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={toggle}>
                <Plus size={16} /> Add question
            </button>
        )}
    />
);

const QuestionList = ({ questions, onChange, errorFor, activeKey, setActiveKey }) => {
    const update = (index, next) => onChange(questions.map((question, i) => (i === index ? next : question)));
    const move = (index, step) => {
        const next = [...questions];
        const [item] = next.splice(index, 1);
        next.splice(index + step, 0, item);
        onChange(next);
    };
    return (
        <div className="recruit-q-list">
            {questions.map((question, index) => (
                <QuestionEditor
                    key={question.key}
                    question={question}
                    index={index}
                    count={questions.length}
                    active={question.key === activeKey}
                    onActivate={() => setActiveKey(question.key)}
                    error={errorFor(index)}
                    onChange={(next) => update(index, next)}
                    onMove={(step) => move(index, step)}
                    onRemove={() => onChange(questions.filter((_, i) => i !== index))}
                    onDuplicate={() => {
                        const copy = { ...question, key: key(), _id: undefined, options: [...question.options] };
                        onChange([...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)]);
                        setActiveKey(copy.key);
                    }}
                />
            ))}
            {questions.length < MAX_QUESTIONS_PER_PAGE && (
                <AddQuestion
                    onAdd={(type) => {
                        const question = blankQuestion(type);
                        onChange([...questions, question]);
                        setActiveKey(question.key);
                    }}
                />
            )}
        </div>
    );
};

// ---------------------------------------------------------------- Pages

const PagesEditor = ({ pages, onChange, errors, prefix }) => {
    const [activeKey, setActiveKey] = useState(null);
    const update = (index, changes) => onChange(pages.map((page, i) => (i === index ? { ...page, ...changes } : page)));
    const move = (index, step) => {
        const next = [...pages];
        const [item] = next.splice(index, 1);
        next.splice(index + step, 0, item);
        onChange(next);
    };
    return (
        <div className="stack">
            {!pages.length && <p className="subtle">No form pages — students only confirm their details. Add a page to ask questions.</p>}
            {pages.map((page, index) => (
                <section key={page.key} className="recruit-page-edit" style={{ "--i": index }}>
                    <header className="recruit-page-edit-head">
                        <span className="recruit-page-num">Page {index + 1}</span>
                        <span className="recruit-page-count subtle small">{plural(page.questions.length, "question")}</span>
                        <span style={{ marginLeft: "auto" }}>
                            <ActionMenu
                                label={`Page ${index + 1} actions`}
                                items={[
                                    { label: "Move page up", icon: ArrowUp, onClick: () => move(index, -1), disabled: index === 0 },
                                    { label: "Move page down", icon: ArrowDown, onClick: () => move(index, 1), disabled: index === pages.length - 1 },
                                    "divider",
                                    { label: "Delete page", icon: Trash2, onClick: () => onChange(pages.filter((_, i) => i !== index)), danger: true }
                                ]}
                            />
                        </span>
                    </header>
                    <div className="form-grid">
                        <Input label="Page title" value={page.title} onChange={(event) => update(index, { title: event.target.value })} maxLength={80} placeholder="e.g. Your experience" error={errors[`${prefix}.${index}`]} required />
                        <Input label="Intro (optional)" value={page.description} onChange={(event) => update(index, { description: event.target.value })} maxLength={300} placeholder="Shown at the top of the page" />
                    </div>
                    <QuestionList
                        questions={page.questions}
                        onChange={(questions) => update(index, { questions })}
                        errorFor={(q) => errors[`${prefix}.${index}.${q}`]}
                        activeKey={activeKey}
                        setActiveKey={setActiveKey}
                    />
                </section>
            ))}
            {pages.length < MAX_PAGES && (
                <button type="button" className="recruit-add-page" onClick={() => onChange([...pages, blankPage(pages.length + 1)])}>
                    <Plus size={16} /> Add page
                </button>
            )}
        </div>
    );
};

// What students will see: one step per page.
const FormPreview = ({ pages }) =>
    pages.length ? (
        <ol className="recruit-preview-pages">
            {pages.map((page, index) => (
                <li key={page.key}>
                    <div className="recruit-preview-page-head">
                        <span className="recruit-step-dot">{index + 1}</span>
                        <div>
                            <strong>{page.title || "Untitled page"}</strong>
                            {page.description && <p className="subtle small">{page.description}</p>}
                        </div>
                    </div>
                    <div className="stack-sm">
                        {page.questions.length ? page.questions.map((question) => <QuestionPreview key={question.key} question={question} />) : <p className="subtle small">No questions on this page yet.</p>}
                    </div>
                </li>
            ))}
        </ol>
    ) : (
        <p className="subtle">No questions — students confirm their details and submit.</p>
    );

// ---------------------------------------------------------------- Roles

const RolePicker = ({ roles, positions, onAdd }) => {
    const chosen = new Set(positions.map((position) => position.role));
    const available = roles.filter((role) => role.key !== "PRESIDENT" && !chosen.has(role.key));
    if (!available.length) {
        return null;
    }
    return (
        <div className="recruit-role-picker" role="group" aria-label="Roles you can recruit for">
            {available.map((role) => {
                const taken = role.key === "VICE_PRESIDENT" && role.holder;
                return (
                    <button
                        key={role.key}
                        type="button"
                        className="recruit-role-option"
                        onClick={() => onAdd(role)}
                        disabled={Boolean(taken) || positions.length >= 10}
                        title={taken ? `${role.holder.name} is vice-president` : `Recruit for ${role.name}`}
                    >
                        <Plus size={14} /> {role.name}
                        {taken && <span className="small"> · held</span>}
                    </button>
                );
            })}
        </div>
    );
};

// Once a role is chosen, more roles are added from a menu at the end of the role tabs.
const AddRole = ({ roles, positions, onAdd }) => {
    const chosen = new Set(positions.map((position) => position.role));
    const available = roles.filter((role) => role.key !== "PRESIDENT" && !chosen.has(role.key));
    if (!available.length || positions.length >= 10) {
        return null;
    }
    return (
        <ActionMenu
            align="left"
            label="Add a role"
            items={available.map((role) => {
                const taken = role.key === "VICE_PRESIDENT" && role.holder;
                return { label: taken ? `${role.name} — held by ${role.holder.name}` : role.name, icon: UserRoundPlus, onClick: () => onAdd(role), disabled: Boolean(taken) };
            })}
            trigger={({ open, toggle, menuId }) => (
                <button type="button" className="recruit-role-tab is-add" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={toggle}>
                    <span>
                        <Plus size={15} /> Add role
                    </span>
                    <span className="recruit-role-tab-meta">{plural(available.length, "more role")}</span>
                </button>
            )}
        />
    );
};

const PositionEditor = ({ position, index, positions, onChange, onRemove, errors }) => {
    const [view, setView] = useState("edit");
    const others = positions.filter((other) => other.key !== position.key && other.pages.length);
    const vice = position.role === "VICE_PRESIDENT";
    return (
        <div className="stack-lg recruit-position-editor" key={position.key}>
            <div className="recruit-position-settings">
                <Input
                    label="Openings"
                    type="number"
                    min={1}
                    max={500}
                    value={vice ? 1 : position.openings}
                    onChange={(event) => onChange({ openings: event.target.value })}
                    placeholder="Any"
                    disabled={vice}
                    hint={vice ? "One vice-president per club" : "Empty = no limit"}
                />
                <Input
                    className="recruit-position-desc"
                    label="What they'll do (optional)"
                    value={position.description}
                    onChange={(event) => onChange({ description: event.target.value })}
                    maxLength={400}
                    placeholder="Shown on the role's card"
                />
            </div>
            <div className="recruit-form-toolbar">
                <h3 className="row">
                    <FileText size={16} /> Application form
                </h3>
                <Segmented
                    label="Form view"
                    value={view}
                    onChange={setView}
                    options={[
                        { value: "edit", label: "Edit" },
                        { value: "preview", label: "Preview" }
                    ]}
                />
                <ActionMenu
                    label={`${position.title} options`}
                    items={[
                        ...others.map((other) => ({ label: `Copy form from ${other.title}`, icon: Copy, onClick: () => onChange({ pages: clonePages(other.pages) }) })),
                        others.length ? "divider" : null,
                        { label: `Stop recruiting for ${position.title}`, icon: X, onClick: onRemove, danger: true }
                    ]}
                />
            </div>
            <div className="recruit-view" key={view}>
                {view === "preview" ? <FormPreview pages={position.pages} /> : <PagesEditor pages={position.pages} onChange={(pages) => onChange({ pages })} errors={errors} prefix={index} />}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------- Page

/** Create (/clubs/:id/recruitment/new) or edit (/recruitment/:id/edit) a recruitment drive. */
const DriveFormPage = () => {
    const { id: routeClubId, driveId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const isEdit = Boolean(driveId);
    const existing = useApi(() => recruitmentApi.get(driveId), [driveId], { enabled: isEdit });
    const clubId = routeClubId || existing.data?.club?._id;
    const clubRoles = useApi(() => clubApi.roles(clubId), [clubId], { enabled: Boolean(clubId) });
    const batches = useApi(() => referenceApi.batches(), []);
    const [form, setForm] = useState(emptyForm);
    const [active, setActive] = useState(null);
    const [touched, setTouched] = useState(false);
    const [saving, setSaving] = useState(null);

    useEffect(() => {
        if (existing.data) {
            const next = fromDrive(existing.data);
            setForm(next);
            setActive(next.positions[0]?.key || null);
        }
    }, [existing.data]);

    const errors = useMemo(() => validate(form), [form]);
    const shown = touched ? errors : {};
    const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
    const toggleBatch = (code) => setForm((current) => ({ ...current, batches: current.batches.includes(code) ? current.batches.filter((item) => item !== code) : [...current.batches, code] }));
    const setPositions = (update) => setForm((current) => ({ ...current, positions: update(current.positions) }));

    const addRole = (role) => {
        const position = { key: key(), role: role.key, title: role.name, openings: role.key === "VICE_PRESIDENT" ? 1 : "", description: "", pages: starterPages(role.name) };
        setPositions((positions) => [...positions, position]);
        setActive(position.key);
    };
    const removeRole = (positionKey) => {
        const rest = form.positions.filter((position) => position.key !== positionKey);
        setPositions(() => rest);
        setActive(rest[0]?.key || null);
    };

    const save = async (andSubmit) => {
        setTouched(true);
        if (Object.keys(errors).length) {
            const firstRole = form.positions.findIndex((_, index) => problemsIn(errors, index));
            if (firstRole >= 0) setActive(form.positions[firstRole].key);
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
    const activeIndex = form.positions.findIndex((position) => position.key === active);
    const current = form.positions[activeIndex];

    return (
        <AsyncContent loading={(isEdit && existing.loading) || clubRoles.loading} error={existing.error || clubRoles.error} onRetry={existing.error ? existing.reload : clubRoles.reload}>
            <PageHeader
                back={{ to: isEdit ? `/recruitment/${driveId}` : `/clubs/${routeClubId}/recruitment`, label: isEdit ? "Back to the drive" : "Recruitment" }}
                club={club?._id ? club : undefined}
                title={isEdit ? "Edit recruitment drive" : "New recruitment drive"}
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
                                    placeholder="Who should apply, what the team does, how selection works…"
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

                        <Card
                            title={
                                <h2 className="row">
                                    <Layers size={18} /> Roles & application forms
                                </h2>
                            }
                        >
                            <div className="stack-lg">
                                <div className="stack-sm">
                                    <p className="subtle small" style={{ margin: 0 }}>
                                        Each role gets its own form, selection rounds and results. Students can apply for several roles but join in only one. Roles come from your club's{" "}
                                        <Link to={`/clubs/${clubId}/members`}>Roles & authorities</Link> list.
                                    </p>
                                    {!form.positions.length && <RolePicker roles={clubRoles.data?.roles || []} positions={form.positions} onAdd={addRole} />}
                                    {shown.positions && <span className="field-error">{shown.positions}</span>}
                                </div>

                                {form.positions.length > 0 && (
                                    <>
                                        <div className="recruit-role-tabs" role="tablist" aria-label="Roles in this drive">
                                            {form.positions.map((position, index) => {
                                                const problems = touched ? problemsIn(errors, index) : 0;
                                                return (
                                                    <button
                                                        key={position.key}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={position.key === active}
                                                        className={`recruit-role-tab ${position.key === active ? "is-active" : ""}`}
                                                        onClick={() => setActive(position.key)}
                                                    >
                                                        <span>{position.title}</span>
                                                        <span className="recruit-role-tab-meta">
                                                            {plural(position.pages.length, "page")}
                                                            {problems > 0 && <span className="recruit-role-tab-error">{problems}</span>}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                            <AddRole roles={clubRoles.data?.roles || []} positions={form.positions} onAdd={addRole} />
                                        </div>
                                        <p className="subtle small" style={{ margin: 0 }}>
                                            The student's name, email, department and batch are filled in automatically — only ask for what you need.
                                        </p>
                                        {current && (
                                            <PositionEditor
                                                key={current.key}
                                                position={current}
                                                index={activeIndex}
                                                positions={form.positions}
                                                errors={shown}
                                                onChange={(changes) => setPositions((positions) => positions.map((position) => (position.key === current.key ? { ...position, ...changes } : position)))}
                                                onRemove={() => removeRole(current.key)}
                                            />
                                        )}
                                    </>
                                )}
                            </div>
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
