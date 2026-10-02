const AppError = require("./AppError");
const ERROR_CODES = require("../constants/ErrorCodes");

// Custom form questions organisers add to events (registration forms) and hackathons (submission forms).
// Files aren't collected here — students share links instead.

const FORM_QUESTION_TYPES = ["SHORT", "PARAGRAPH", "SINGLE_CHOICE", "MULTI_CHOICE", "LINK", "NUMBER", "PHONE", "DATE"];
const CHOICE_TYPES = ["SINGLE_CHOICE", "MULTI_CHOICE"];
const MAX_QUESTIONS = 25;
const MAX_OPTIONS = 15;
const LIMITS = { SHORT: 200, PARAGRAPH: 3000, LINK: 500, NUMBER: 30, PHONE: 20, DATE: 10 };
const URL_PATTERN = /^https?:\/\/[^\s]+\.[^\s]+$/i;

const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const clean = (value, max) => String(value ?? "").trim().slice(0, max);

/**
 * Validates the organiser's questions. `scopes` (e.g. ["TEAM", "MEMBER"]) lets each question say who answers it.
 */
const normalizeQuestions = (questions = [], { scopes = null, what = "form" } = {}) => {
    if (!Array.isArray(questions)) throw invalid(`The ${what} questions must be a list`);
    if (questions.length > MAX_QUESTIONS) throw invalid(`A ${what} can have up to ${MAX_QUESTIONS} questions`);
    return questions.map((question, index) => {
        const where = `Question ${index + 1}`;
        const type = String(question?.type || "");
        if (!FORM_QUESTION_TYPES.includes(type)) throw invalid(`${where} has an unknown question type`);
        const label = clean(question.label, 200);
        if (!label) throw invalid(`${where} needs a question`);
        let options = [];
        if (CHOICE_TYPES.includes(type)) {
            options = [...new Set((question.options || []).map((option) => clean(option, 100)).filter(Boolean))];
            if (options.length < 2 || options.length > MAX_OPTIONS) throw invalid(`"${label}" needs between 2 and ${MAX_OPTIONS} different options`);
        }
        const out = { ...(question._id ? { _id: question._id } : {}), type, label, help: clean(question.help, 300), required: Boolean(question.required), options };
        if (scopes) out.scope = scopes.includes(question.scope) ? question.scope : scopes[scopes.length - 1];
        return out;
    });
};

/** Checks a person's answers to `questions`; returns [{ question, text, choices }] in question order. */
const readAnswers = (questions = [], input = []) => {
    const given = new Map((Array.isArray(input) ? input : []).map((answer) => [String(answer?.question), answer]));
    return questions.map((question) => {
        const answer = given.get(String(question._id)) || {};
        const out = { question: question._id, text: "", choices: [] };
        if (CHOICE_TYPES.includes(question.type)) {
            const picked = [...new Set((Array.isArray(answer.choices) ? answer.choices : []).map(String))];
            if (picked.some((choice) => !question.options.includes(choice))) throw invalid(`Choose from the options given for "${question.label}"`);
            if (question.type === "SINGLE_CHOICE" && picked.length > 1) throw invalid(`Pick one option for "${question.label}"`);
            if (question.required && !picked.length) throw invalid(`Please answer "${question.label}"`);
            out.choices = picked;
            return out;
        }
        const text = String(answer.text ?? "").trim();
        if (text.length > (LIMITS[question.type] || 200)) throw invalid(`"${question.label}" can be up to ${LIMITS[question.type]} characters`);
        if (question.required && !text) throw invalid(`Please answer "${question.label}"`);
        if (text) {
            if (question.type === "LINK" && !URL_PATTERN.test(text)) throw invalid(`"${question.label}" needs a full link starting with https://`);
            if (question.type === "NUMBER" && !/^-?\d+(\.\d+)?$/.test(text)) throw invalid(`"${question.label}" must be a number`);
            if (question.type === "PHONE" && !/^[+\d][\d\s-]{6,18}$/.test(text)) throw invalid(`"${question.label}" must be a phone number`);
            if (question.type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw invalid(`"${question.label}" must be a date`);
        }
        out.text = text;
        return out;
    });
};

/** "Answer text" for a list or CSV cell. */
const answerText = (question, answer) => (answer ? (CHOICE_TYPES.includes(question.type) ? answer.choices.join(", ") : answer.text) : "");

module.exports = { FORM_QUESTION_TYPES, normalizeQuestions, readAnswers, answerText };
