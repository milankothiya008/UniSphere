const mongoose = require("mongoose");
const { FORM_QUESTION_TYPES } = require("../utils/Forms");

// Shared shapes for organiser-made form questions and people's answers (see utils/Forms).
const formQuestionSchema = (withScope = false) =>
    new mongoose.Schema({
        type: { type: String, enum: FORM_QUESTION_TYPES, required: true },
        label: { type: String, trim: true, required: true, maxlength: 200 },
        help: { type: String, trim: true, maxlength: 300, default: "" },
        required: { type: Boolean, default: false },
        options: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
        // Team events: answered once by the team leader (TEAM) or by every member (MEMBER).
        ...(withScope ? { scope: { type: String, enum: ["TEAM", "MEMBER"], default: "MEMBER" } } : {})
    });

const formAnswerSchema = new mongoose.Schema(
    {
        question: { type: mongoose.Schema.Types.ObjectId, required: true },
        text: { type: String, trim: true, maxlength: 3000, default: "" },
        choices: { type: [String], default: [] }
    },
    { _id: false }
);

module.exports = { formQuestionSchema, formAnswerSchema };
