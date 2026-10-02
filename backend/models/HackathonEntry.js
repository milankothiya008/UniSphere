const mongoose = require("mongoose");
const { formAnswerSchema } = require("./FormSchemas");

// One hackathon entry: a team (team events) or a single student (individual events). It holds the chosen
// problem statement, the submitted project and every judge's scores.

const markSchema = new mongoose.Schema(
    {
        criterion: { type: mongoose.Schema.Types.ObjectId, required: true },
        score: { type: Number, required: true, min: 0 }
    },
    { _id: false }
);

const scoreSchema = new mongoose.Schema(
    {
        judge: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        marks: { type: [markSchema], default: [] },
        // Sum of the marks, kept with the scores for sorting.
        total: { type: Number, default: 0 },
        comment: { type: String, trim: true, maxlength: 1000, default: "" },
        scoredAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const hackathonEntrySchema = new mongoose.Schema(
    {
        event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
        // "team:<id>" or "user:<id>": one entry per team or per individual participant.
        entryKey: { type: String, required: true },
        team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        name: { type: String, required: true, trim: true, maxlength: 120 },
        problemStatement: { type: mongoose.Schema.Types.ObjectId, default: null },
        problemChosenAt: { type: Date, default: null },
        problemChosenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        project: {
            title: { type: String, trim: true, maxlength: 120, default: "" },
            summary: { type: String, trim: true, maxlength: 3000, default: "" },
            repoUrl: { type: String, trim: true, maxlength: 500, default: "" },
            demoUrl: { type: String, trim: true, maxlength: 500, default: "" },
            videoUrl: { type: String, trim: true, maxlength: 500, default: "" },
            deckUrl: { type: String, trim: true, maxlength: 500, default: "" },
            techStack: { type: String, trim: true, maxlength: 300, default: "" }
        },
        // Stage 2: the code repository (project.repoUrl), due by the repository deadline.
        repoSubmittedAt: { type: Date, default: null },
        repoSubmittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        // Stage 3: the final submission (name, description, demo, video, slides). Only these are judged.
        // Answers to the organisers' extra submission questions.
        submissionAnswers: { type: [formAnswerSchema], default: [] },
        submittedAt: { type: Date, default: null },
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        scores: { type: [scoreSchema], default: [] }
    },
    { timestamps: true }
);

hackathonEntrySchema.index({ event: 1, entryKey: 1 }, { unique: true });
hackathonEntrySchema.index({ event: 1, problemStatement: 1 });

module.exports = mongoose.model("HackathonEntry", hackathonEntrySchema);
