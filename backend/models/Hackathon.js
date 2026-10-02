const mongoose = require("mongoose");
const { formQuestionSchema } = require("./FormSchemas");

// Which standard fields the final submission asks for: REQUIRED, OPTIONAL or OFF.
const fieldSetting = { type: String, enum: ["REQUIRED", "OPTIONAL", "OFF"] };

// The hackathon side of a HACKATHON event: agenda, problem statements (hidden until revealAt), the
// deadlines for choosing a problem and submitting a project, judging criteria and the judges.
// Kept apart from Event so problem statements never leak through the public event payload.

const agendaItemSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 120 },
        startsAt: { type: Date, required: true },
        note: { type: String, trim: true, maxlength: 300, default: "" }
    },
    { _id: true }
);

const problemSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 160 },
        description: { type: String, required: true, trim: true, maxlength: 4000 },
        // Optional theme, e.g. "Health", "FinTech".
        track: { type: String, trim: true, maxlength: 60, default: "" },
        // How many teams may pick it (null = any number).
        maxTeams: { type: Number, default: null, min: 1 }
    },
    { _id: true }
);

const criterionSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 60 },
        maxScore: { type: Number, required: true, min: 1, max: 100 }
    },
    { _id: true }
);

const judgeSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        addedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const hackathonSchema = new mongoose.Schema(
    {
        event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, unique: true },
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        agenda: { type: [agendaItemSchema], default: [] },
        problemStatements: { type: [problemSchema], default: [] },
        // Problem statements become visible to participants at revealAt (never before the event starts).
        revealAt: { type: Date, required: true },
        // Three stages, each with its own deadline: choose a problem statement (selectionDeadline), register the
        // code repository (repoDeadline), then — once the repository deadline has passed — the final submission
        // with the demo, video and slides (submissionDeadline).
        selectionDeadline: { type: Date, required: true },
        repoDeadline: { type: Date, default: null },
        submissionDeadline: { type: Date, required: true },
        criteria: { type: [criterionSchema], default: [] },
        // The final submission form, decided by the organisers. Name and description are always asked.
        submissionFields: {
            demoUrl: { ...fieldSetting, default: "OPTIONAL" },
            videoUrl: { ...fieldSetting, default: "OPTIONAL" },
            deckUrl: { ...fieldSetting, default: "OPTIONAL" },
            techStack: { ...fieldSetting, default: "OPTIONAL" }
        },
        // Extra questions for the final submission (e.g. "Which APIs did you use?").
        submissionQuestions: { type: [formQuestionSchema(false)], default: [] },
        judges: { type: [judgeSchema], default: [] },
        // Time-based notifications already sent: REVEAL, SELECTION_1H, SUBMISSION_1H, JUDGING_OPEN.
        notified: { type: [String], default: [] },
        resultsDraftedAt: { type: Date, default: null },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
    },
    { timestamps: true }
);

hackathonSchema.index({ "judges.user": 1 });

module.exports = mongoose.model("Hackathon", hackathonSchema);
