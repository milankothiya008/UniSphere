import { useState } from "react";
import { AlignLeft, ArrowDown, ArrowUp, Calendar, CircleDot, Copy, Hash, Link2, Phone, Plus, SquareCheck, Trash2, Type, Users, User, X } from "lucide-react";
import { ActionMenu, Field, Input, Segmented, Select, Switch } from "../ui";

// Builder for the short forms clubs attach to events (registration) and hackathons (final submission).
// Same look as the recruitment form builder: one question open at a time, the rest as compact rows.

export const FORM_TYPES = [
    { value: "SHORT", label: "Short answer", icon: Type },
    { value: "PARAGRAPH", label: "Paragraph", icon: AlignLeft },
    { value: "SINGLE_CHOICE", label: "Multiple choice (one)", icon: CircleDot },
    { value: "MULTI_CHOICE", label: "Checkboxes (several)", icon: SquareCheck },
    { value: "NUMBER", label: "Number", icon: Hash },
    { value: "PHONE", label: "Phone number", icon: Phone },
    { value: "DATE", label: "Date", icon: Calendar },
    { value: "LINK", label: "Link", icon: Link2 }
];
const TYPE = Object.fromEntries(FORM_TYPES.map((type) => [type.value, type]));
const CHOICE = ["SINGLE_CHOICE", "MULTI_CHOICE"];
const MAX = 25;

let seed = 0;
const newKey = () => `q${(seed += 1)}`;

/** Adds client keys to stored questions so they can be edited. */
export const withKeys = (questions = []) => questions.map((question) => ({ ...question, key: question.key || question._id || newKey(), options: question.options || [] }));

/** What goes to the server (drops client keys and empty options). */
export const toQuestionPayload = (questions = []) =>
    questions.map(({ key: _key, ...question }) => ({ ...question, options: CHOICE.includes(question.type) ? question.options.map((option) => option.trim()).filter(Boolean) : [] }));

/** First problem in the questions, for the form's own validation. */
export const questionProblem = (questions = []) => {
    for (const [index, question] of questions.entries()) {
        if (!question.label?.trim()) return `Question ${index + 1} needs a question`;
        if (CHOICE.includes(question.type) && question.options.filter((option) => option.trim()).length < 2) return `"${question.label}" needs at least two options`;
    }
    return null;
};

const Row = ({ question, index, count, active, onActivate, onChange, onMove, onRemove, onDuplicate, withScope }) => {
    const Icon = TYPE[question.type]?.icon || Type;
    const menu = (
        <ActionMenu
            label={`Question ${index + 1} actions`}
            items={[
                { label: "Move up", icon: ArrowUp, onClick: () => onMove(-1), disabled: index === 0 },
                { label: "Move down", icon: ArrowDown, onClick: () => onMove(1), disabled: index === count - 1 },
                { label: "Duplicate", icon: Copy, onClick: onDuplicate },
                "divider",
                { label: "Delete question", icon: Trash2, onClick: onRemove, danger: true }
            ]}
        />
    );
    if (!active) {
        return (
            <div className="recruit-q-row" style={{ "--i": index }}>
                <button type="button" className="recruit-q-row-main" onClick={onActivate} aria-label={`Edit question ${index + 1}: ${question.label || "untitled"}`}>
                    <span className="recruit-q-icon">
                        <Icon size={15} />
                    </span>
                    <span className="recruit-q-text">
                        <strong>
                            {question.label || <span className="subtle">Untitled question</span>}
                            {question.required && <span className="req"> *</span>}
                        </strong>
                        <span className="subtle small">
                            {TYPE[question.type]?.label}
                            {withScope ? ` · ${question.scope === "TEAM" ? "once per team" : "every member"}` : ""}
                        </span>
                    </span>
                </button>
                {menu}
            </div>
        );
    }
    const setOptions = (options) => onChange({ ...question, options });
    return (
        <div className="recruit-question">
            <div className="recruit-question-head">
                <span className="recruit-question-num">
                    <Icon size={14} /> Question {index + 1}
                </span>
                {menu}
            </div>
            <div className="recruit-question-grid">
                <Input label="Question" value={question.label} onChange={(e) => onChange({ ...question, label: e.target.value })} maxLength={200} placeholder="Ask something" autoFocus={!question.label} required />
                <Select
                    label="Answer type"
                    value={question.type}
                    onChange={(e) => {
                        const type = e.target.value;
                        onChange({ ...question, type, options: CHOICE.includes(type) ? (question.options.length >= 2 ? question.options : ["", ""]) : [] });
                    }}
                    options={FORM_TYPES.map(({ value, label }) => ({ value, label }))}
                />
            </div>
            <Input label="Help text (optional)" value={question.help || ""} onChange={(e) => onChange({ ...question, help: e.target.value })} maxLength={300} placeholder="Shown under the question" />
            {CHOICE.includes(question.type) && (
                <Field label="Options">
                    <div className="recruit-options">
                        {question.options.map((option, optionIndex) => (
                            <div key={optionIndex} className="recruit-option">
                                <span className={question.type === "SINGLE_CHOICE" ? "recruit-radio" : "recruit-box"} aria-hidden="true" />
                                <input
                                    className="input"
                                    value={option}
                                    onChange={(e) => setOptions(question.options.map((item, i) => (i === optionIndex ? e.target.value : item)))}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            if (optionIndex === question.options.length - 1 && question.options.length < 15) setOptions([...question.options, ""]);
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
                        {question.options.length < 15 && (
                            <button type="button" className="recruit-option-add" onClick={() => setOptions([...question.options, ""])}>
                                <Plus size={14} /> Add option
                            </button>
                        )}
                    </div>
                </Field>
            )}
            {withScope && (
                <Field label="Who answers?">
                    <Segmented
                        label="Who answers"
                        value={question.scope || "MEMBER"}
                        onChange={(scope) => onChange({ ...question, scope })}
                        options={[
                            { value: "TEAM", label: <><Users size={14} /> Once per team</> },
                            { value: "MEMBER", label: <><User size={14} /> Every member</> }
                        ]}
                    />
                </Field>
            )}
            <Switch checked={question.required} onChange={(required) => onChange({ ...question, required })} label="Required" description="They can't continue without answering" />
        </div>
    );
};

/** Editable list of questions. `withScope` adds "once per team / every member" (team events). */
export const QuestionBuilder = ({ questions, onChange, withScope = false, emptyHint }) => {
    const [active, setActive] = useState(questions[0]?.key || null);
    const update = (index, next) => onChange(questions.map((question, i) => (i === index ? next : question)));
    const move = (index, step) => {
        const next = [...questions];
        const [item] = next.splice(index, 1);
        next.splice(index + step, 0, item);
        onChange(next);
    };
    const add = (type) => {
        const question = { key: newKey(), type, label: "", help: "", required: false, options: CHOICE.includes(type) ? ["", ""] : [], ...(withScope ? { scope: "MEMBER" } : {}) };
        onChange([...questions, question]);
        setActive(question.key);
    };
    return (
        <div className="recruit-q-list">
            {!questions.length && emptyHint && <p className="subtle small" style={{ margin: 0 }}>{emptyHint}</p>}
            {questions.map((question, index) => (
                <Row
                    key={question.key}
                    question={question}
                    index={index}
                    count={questions.length}
                    active={question.key === active}
                    withScope={withScope}
                    onActivate={() => setActive(question.key)}
                    onChange={(next) => update(index, next)}
                    onMove={(step) => move(index, step)}
                    onRemove={() => onChange(questions.filter((_, i) => i !== index))}
                    onDuplicate={() => {
                        const copy = { ...question, key: newKey(), _id: undefined, options: [...question.options] };
                        onChange([...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)]);
                        setActive(copy.key);
                    }}
                />
            ))}
            {questions.length < MAX && (
                <ActionMenu
                    align="left"
                    label="Add a question"
                    items={FORM_TYPES.map((type) => ({ label: type.label, icon: type.icon, onClick: () => add(type.value) }))}
                    trigger={({ open, toggle, menuId }) => (
                        <button type="button" className="recruit-add-q" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={toggle}>
                            <Plus size={16} /> Add question
                        </button>
                    )}
                />
            )}
        </div>
    );
};
