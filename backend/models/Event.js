const mongoose = require("mongoose");
const { EVENT_STATUS } = require("../constants/Statuses");

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
            enum: [
                "TECHNOLOGY",
                "SPORTS",
                "CULTURAL",
                "LITERARY",
                "MUSIC",
                "ART",
                "SOCIAL_SERVICE",
                "ENTREPRENEURSHIP",
                "WORKSHOP",
                "OTHER"
            ]
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
        eligibility: {
            departments: { type: [String], default: [] },
            batches: { type: [String], default: [] },
            notes: { type: String, default: "" }
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
        rejectionReason: {
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
        publishedAt: {
            type: Date,
            default: null
        },
        completedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

eventSchema.index({ club: 1, status: 1 });
eventSchema.index({ status: 1, startAt: 1 });
eventSchema.index({ venue: 1, startAt: 1, endAt: 1 });
eventSchema.index({ registrationStart: 1, registrationEnd: 1 });

eventSchema.pre("validate", function (next) {
    if (this.startAt && this.endAt && this.startAt >= this.endAt) {
        this.invalidate("endAt", "Event end must be after event start");
    }

    if (this.registrationStart && this.registrationEnd && this.registrationStart >= this.registrationEnd) {
        this.invalidate("registrationEnd", "Registration end must be after registration start");
    }

    next();
});

module.exports = mongoose.model("Event", eventSchema);
