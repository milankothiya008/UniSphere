const mongoose = require("mongoose");
const { APPLICATION_STATUS, ROUND_OUTCOMES } = require("../constants/Statuses");

// A student's answer to one question. Files (resumes, portfolios) live in media storage; only their
// description is kept here, like stories and gallery items.
const answerSchema = new mongoose.Schema(
    {
        question: { type: mongoose.Schema.Types.ObjectId, required: true },
        text: { type: String, trim: true, maxlength: 5000, default: "" },
        choices: { type: [String], default: [] },
        file: {
            type: new mongoose.Schema(
                {
                    kind: { type: String, enum: ["IMAGE", "DOCUMENT"], required: true },
                    provider: { type: String, enum: ["cloudinary", "local"], required: true },
                    key: { type: String, required: true },
                    version: { type: Number, default: null },
                    format: { type: String, default: null },
                    name: { type: String, trim: true, maxlength: 200, default: null },
                    bytes: { type: Number, default: null }
                },
                { _id: false }
            ),
            default: null
        }
    },
    { _id: false }
);

const roundResultSchema = new mongoose.Schema(
    {
        round: { type: mongoose.Schema.Types.ObjectId, required: true },
        outcome: { type: String, enum: Object.values(ROUND_OUTCOMES), required: true },
        note: { type: String, trim: true, maxlength: 500, default: null },
        publishedAt: { type: Date, default: null }
    },
    { _id: false }
);

const slotSchema = new mongoose.Schema(
    {
        round: { type: mongoose.Schema.Types.ObjectId, required: true },
        startAt: { type: Date, required: true },
        endAt: { type: Date, required: true }
    },
    { _id: false }
);

const recruitmentApplicationSchema = new mongoose.Schema(
    {
        drive: { type: mongoose.Schema.Types.ObjectId, ref: "RecruitmentDrive", required: true },
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        // Position ids from the drive, in order of preference.
        positions: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        answers: { type: [answerSchema], default: [] },
        status: { type: String, enum: Object.values(APPLICATION_STATUS), default: APPLICATION_STATUS.APPLIED },
        // Published results, one per round the candidate took part in.
        roundResults: { type: [roundResultSchema], default: [] },
        // The president's decision for the current round, not shown to the student until published.
        pendingOutcome: {
            round: { type: mongoose.Schema.Types.ObjectId, default: null },
            outcome: { type: String, enum: [...Object.values(ROUND_OUTCOMES), null], default: null },
            note: { type: String, trim: true, maxlength: 500, default: null }
        },
        // Individual interview times (rounds with per-candidate slots) and common times copied per candidate,
        // so reminders work the same way for both.
        slots: { type: [slotSchema], default: [] },
        remindersSent: {
            type: [new mongoose.Schema({ round: mongoose.Schema.Types.ObjectId, kind: String, at: Date }, { _id: false })],
            default: []
        },
        finalRole: { type: String, default: null },
        decidedAt: { type: Date, default: null },
        withdrawnAt: { type: Date, default: null }
    },
    { timestamps: true }
);

recruitmentApplicationSchema.index({ drive: 1, applicant: 1 }, { unique: true });
recruitmentApplicationSchema.index({ drive: 1, status: 1, createdAt: 1 });
recruitmentApplicationSchema.index({ applicant: 1, createdAt: -1 });
recruitmentApplicationSchema.index({ "slots.startAt": 1 });

module.exports = mongoose.model("RecruitmentApplication", recruitmentApplicationSchema);
