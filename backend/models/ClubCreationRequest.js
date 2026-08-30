const mongoose = require("mongoose");
const { CLUB_REQUEST_STATUS } = require("../constants/Statuses");

const historySchema = new mongoose.Schema(
    {
        action: { type: String, required: true },
        fromStatus: { type: String, default: null },
        toStatus: { type: String, required: true },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        reason: { type: String, default: null },
        at: { type: Date, default: Date.now }
    },
    { _id: false }
);

const clubCreationRequestSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 4000
        },
        purpose: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000
        },
        proposedActivities: {
            type: String,
            required: true,
            trim: true,
            maxlength: 4000
        },
        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000
        },
        departmentCode: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
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
                "OTHER"
            ]
        },
        requester: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        status: {
            type: String,
            enum: Object.values(CLUB_REQUEST_STATUS),
            default: CLUB_REQUEST_STATUS.PENDING_COORDINATOR_REVIEW
        },
        recommendedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        recommendedAt: {
            type: Date,
            default: null
        },
        decidedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        decidedAt: {
            type: Date,
            default: null
        },
        rejectionReason: {
            type: String,
            default: null
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            default: null
        },
        history: {
            type: [historySchema],
            default: []
        }
    },
    { timestamps: true }
);

clubCreationRequestSchema.index({ status: 1, createdAt: -1 });
clubCreationRequestSchema.index({ requester: 1 });

module.exports = mongoose.model("ClubCreationRequest", clubCreationRequestSchema);
