const mongoose = require("mongoose");
const { clearOnWrite } = require("../utils/TtlCache");
const { clubDirectoryCache } = require("../utils/Caches");
const { RECRUITMENT_STATUS, ROUND_STATUS, ROUND_MODES, ROUND_TIMING, QUESTION_TYPES } = require("../constants/Statuses");

// One question of a role's application form. The applicant's name, email, department and batch come from
// their profile and are never asked again.
const questionSchema = new mongoose.Schema({
    type: { type: String, enum: Object.values(QUESTION_TYPES), required: true },
    label: { type: String, trim: true, required: true, maxlength: 200 },
    help: { type: String, trim: true, maxlength: 300, default: "" },
    required: { type: Boolean, default: false },
    options: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] }
});

// Forms are page-wise: applicants fill one page, then Next.
const pageSchema = new mongoose.Schema({
    title: { type: String, trim: true, required: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    questions: { type: [questionSchema], default: [] }
});

// A selection round of one role. Screening rounds have no meeting; online rounds have a meeting link,
// offline rounds a venue. Timing is one common slot for everyone or an individual slot per candidate (kept
// on the application); startAt / endAt always span the whole round, so the venue booking covers every slot.
const roundSchema = new mongoose.Schema(
    {
        name: { type: String, trim: true, required: true, maxlength: 80 },
        mode: { type: String, enum: Object.values(ROUND_MODES), required: true },
        timing: { type: String, enum: [...Object.values(ROUND_TIMING), null], default: null },
        startAt: { type: Date, default: null },
        endAt: { type: Date, default: null },
        slotMinutes: { type: Number, min: 5, max: 240, default: null },
        venue: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", default: null },
        meetingLink: { type: String, trim: true, maxlength: 500, default: null },
        instructions: { type: String, trim: true, maxlength: 1000, default: "" },
        status: { type: String, enum: Object.values(ROUND_STATUS), default: ROUND_STATUS.DRAFT },
        scheduledAt: { type: Date, default: null },
        resultsPublishedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

// A role being recruited for. Each role has its own form, its own rounds and its own results.
const positionSchema = new mongoose.Schema({
    // Key of one of the club's roles (Club.roles) — what a student who accepts becomes.
    role: { type: String, required: true },
    // The role's name when the drive was created.
    title: { type: String, trim: true, required: true, maxlength: 60 },
    openings: { type: Number, min: 1, max: 500, default: null },
    description: { type: String, trim: true, maxlength: 400, default: "" },
    form: {
        pages: { type: [pageSchema], default: [] }
    },
    rounds: { type: [roundSchema], default: [] },
    // Set when the president makes the final selection for this role (offers, reserves, not selected).
    finalizedAt: { type: Date, default: null },
    offerDays: { type: Number, min: 1, max: 14, default: 3 }
});

const recruitmentDriveSchema = new mongoose.Schema(
    {
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        title: { type: String, trim: true, required: true, maxlength: 120 },
        description: { type: String, trim: true, required: true, maxlength: 4000 },
        positions: { type: [positionSchema], default: [] },
        // Departments come from the club's own scope; the president can narrow the batches.
        eligibility: {
            batches: { type: [String], default: [] }
        },
        applicationStart: { type: Date, required: true },
        applicationEnd: { type: Date, required: true },
        // Set when the president closes applications before the deadline.
        closedAt: { type: Date, default: null },

        status: { type: String, enum: Object.values(RECRUITMENT_STATUS), default: RECRUITMENT_STATUS.DRAFT },
        submittedAt: { type: Date, default: null },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reviewedAt: { type: Date, default: null },
        reviewComment: { type: String, trim: true, maxlength: 2000, default: null },
        publishedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        cancellationReason: { type: String, trim: true, maxlength: 500, default: null },

        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
    },
    { timestamps: true }
);

recruitmentDriveSchema.index({ club: 1, status: 1 });
recruitmentDriveSchema.index({ status: 1, applicationEnd: 1 });
// Venue bookings held by scheduled offline rounds.
recruitmentDriveSchema.index({ "positions.rounds.venue": 1, "positions.rounds.startAt": 1 });

// Any write refreshes the cached clubs directory (utils/Caches.js).
clearOnWrite(recruitmentDriveSchema, () => clubDirectoryCache.clear());

module.exports = mongoose.model("RecruitmentDrive", recruitmentDriveSchema);
