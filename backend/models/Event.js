const mongoose = require("mongoose");
const { EVENT_STATUS, REVISION_STATUS, PARTICIPATION_MODES, CHECK_IN_STATUS } = require("../constants/Statuses");
const { EVENT_CATEGORIES } = require("../constants/Categories");

const eventSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, "Event title is required"],
            trim: true,
            maxlength: 160
        },
        shortDescription: {
            type: String,
            required: [true, "Short description is required"],
            trim: true,
            maxlength: 280
        },
        description: {
            type: String,
            required: [true, "Event description is required"],
            trim: true,
            maxlength: 8000
        },
        category: {
            type: String,
            required: true,
            enum: EVENT_CATEGORIES
        },
        poster: {
            type: String,
            default: null
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        venue: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Venue",
            required: true
        },
        eventDate: {
            type: Date,
            required: true
        },
        startTime: {
            type: String,
            required: true
        },
        endTime: {
            type: String,
            required: true
        },
        startAt: {
            type: Date,
            required: true
        },
        endAt: {
            type: Date,
            required: true
        },
        registrationStart: {
            type: Date,
            required: true
        },
        registrationEnd: {
            type: Date,
            required: true
        },
        registrationClosed: {
            type: Boolean,
            default: false
        },
        maxParticipants: {
            type: Number,
            default: null,
            min: 1
        },
        registeredCount: {
            type: Number,
            default: 0,
            min: 0
        },
        // Students queued for a seat once the event is full (see WaitlistService).
        waitlistCount: {
            type: Number,
            default: 0,
            min: 0
        },
        // Individual events take one student per registration; team events take a team led by the student who
        // registers (see TeamService). For team events maxParticipants is the number of teams.
        participationMode: {
            type: String,
            enum: Object.values(PARTICIPATION_MODES),
            default: PARTICIPATION_MODES.INDIVIDUAL
        },
        minTeamSize: {
            type: Number,
            default: 1,
            min: 1,
            max: 20
        },
        maxTeamSize: {
            type: Number,
            default: 1,
            min: 1,
            max: 20
        },
        eligibility: {
            departments: { type: [String], default: [] },
            batches: { type: [String], default: [] },
            notes: { type: String, default: "" }
        },
        rules: {
            type: String,
            trim: true,
            maxlength: 8000,
            default: ""
        },
        contact: {
            name: { type: String, trim: true, default: "" },
            email: { type: String, trim: true, lowercase: true, default: "" },
            phone: { type: String, trim: true, default: "" }
        },
        organizer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        status: {
            type: String,
            enum: Object.values(EVENT_STATUS),
            default: EVENT_STATUS.DRAFT
        },
        reviewComment: {
            type: String,
            default: null
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        reviewedAt: {
            type: Date,
            default: null
        },
        submittedAt: {
            type: Date,
            default: null
        },
        publishedAt: {
            type: Date,
            default: null
        },
        completedAt: {
            type: Date,
            default: null
        },
        cancelledAt: {
            type: Date,
            default: null
        },
        cancellationReason: {
            type: String,
            default: null
        },
        // Check-in at the door (see services/CheckInService): the president opens it, officers scan tickets.
        checkIn: {
            type: new mongoose.Schema(
                {
                    status: { type: String, enum: Object.values(CHECK_IN_STATUS), default: CHECK_IN_STATUS.NOT_STARTED },
                    openedAt: { type: Date, default: null },
                    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
                    closedAt: { type: Date, default: null },
                    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
                },
                { _id: false }
            ),
            default: () => ({ status: CHECK_IN_STATUS.NOT_STARTED })
        },
        // Proposed changes to a published event. The live event stays as it is until the faculty mentor
        // approves the changes and the club publishes them (see EventService revision functions).
        revision: {
            type: new mongoose.Schema(
                {
                    status: { type: String, enum: Object.values(REVISION_STATUS), required: true },
                    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
                    fields: { type: [String], default: [] },
                    note: { type: String, default: "" },
                    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                    requestedAt: { type: Date, default: Date.now },
                    reviewComment: { type: String, default: null },
                    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
                    reviewedAt: { type: Date, default: null }
                },
                { _id: false }
            ),
            default: null
        }
    },
    { timestamps: true }
);

eventSchema.index({ club: 1, status: 1 });
eventSchema.index({ status: 1, startAt: 1 });
eventSchema.index({ venue: 1, startAt: 1, endAt: 1 });
eventSchema.index({ registrationStart: 1, registrationEnd: 1 });
eventSchema.index({ club: 1, "revision.status": 1 });

// Mongoose 9 middleware no longer receives `next`; throwing or invalidating is enough.
eventSchema.pre("validate", function () {
    if (this.startAt && this.endAt && this.startAt >= this.endAt) {
        this.invalidate("endAt", "Event end must be after event start");
    }

    if (this.minTeamSize > this.maxTeamSize) {
        this.invalidate("minTeamSize", "Minimum team size cannot be larger than the maximum");
    }

    if (this.registrationStart && this.registrationEnd && this.registrationStart >= this.registrationEnd) {
        this.invalidate("registrationEnd", "Registration deadline must be after registration start");
    }
});

module.exports = mongoose.model("Event", eventSchema);
