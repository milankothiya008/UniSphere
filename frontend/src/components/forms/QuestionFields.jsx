import { Field, Input, Textarea } from "../ui";

// Renders organiser questions for someone to answer, and keeps the answers as [{ question, text, choices }].

const CHOICE = ["SINGLE_CHOICE", "MULTI_CHOICE"];

export const answersMap = (answers = []) => Object.fromEntries(answers.map((answer) => [String(answer.question), { text: answer.text || "", choices: answer.choices || [] }]));

export const toAnswers = (questions = [], values = {}) => questions.map((question) => ({ question: question._id, text: values[question._id]?.text || "", choices: values[question._id]?.choices || [] }));

/** First required question left empty, or null. */
export const missingAnswer = (questions = [], values = {}) =>
    questions.find((question) => {
        if (!question.required) return false;
        const value = values[question._id] || {};
        return CHOICE.includes(question.type) ? !value.choices?.length : !String(value.text || "").trim();
    }) || null;

const INPUT_TYPE = { LINK: "url", NUMBER: "number", PHONE: "tel", DATE: "date" };

export const QuestionFields = ({ questions = [], values = {}, onChange, idPrefix = "q" }) => {
    const set = (question, patch) => onChange({ ...values, [question._id]: { text: "", choices: [], ...values[question._id], ...patch } });
    return (
        <div className="stack">
            {questions.map((question) => {
                const value = values[question._id] || { text: "", choices: [] };
                if (CHOICE.includes(question.type)) {
                    const multi = question.type === "MULTI_CHOICE";
                    return (
                        <Field key={question._id} label={question.label} hint={question.help || (multi ? "Choose all that apply" : null)} required={question.required}>
                            <div className="choice-list" role={multi ? "group" : "radiogroup"} aria-label={question.label}>
                                {question.options.map((option) => {
                                    const on = value.choices.includes(option);
                                    return (
                                        <label key={option} className={`choice ${on ? "is-on" : ""}`}>
                                            <input
                                                type={multi ? "checkbox" : "radio"}
                                                name={`${idPrefix}-${question._id}`}
                                                checked={on}
                                                onChange={() => set(question, { choices: multi ? (on ? value.choices.filter((item) => item !== option) : [...value.choices, option]) : [option] })}
                                            />
                                            <span>{option}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </Field>
                    );
                }
                if (question.type === "PARAGRAPH") {
                    return <Textarea key={question._id} label={question.label} hint={question.help || null} required={question.required} value={value.text} onChange={(e) => set(question, { text: e.target.value })} rows={4} maxLength={3000} />;
                }
                return (
                    <Input
                        key={question._id}
                        label={question.label}
                        hint={question.help || null}
                        required={question.required}
                        type={INPUT_TYPE[question.type] || "text"}
                        placeholder={question.type === "LINK" ? "https://" : undefined}
                        value={value.text}
                        onChange={(e) => set(question, { text: e.target.value })}
                        maxLength={question.type === "LINK" ? 500 : 200}
                    />
                );
            })}
        </div>
    );
};
