const mongoose = require("mongoose");
const { CLUB_REQUEST_STATUS } = require("../constants/Statuses");
const { CLUB_CATEGORIES } = require("../constants/Categories");

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
        // Either open to every department, or limited to departmentCodes (see utils/DepartmentScope).
        allDepartments: {
            type: Boolean,
            default: false
        },
        departmentCodes: {
            type: [{ type: String, uppercase: true, trim: true }],
            default: []
        },
        category: {
            type: String,
            required: true,
            enum: CLUB_CATEGORIES
        },
        requester: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        foundingMembers: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
            default: []
        },
        proposedMentor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        status: {
            type: String,
            enum: Object.values(CLUB_REQUEST_STATUS),
            default: CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW
        },
        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        verifiedAt: {
            type: Date,
            default: null
        },
        reviewComment: {
            type: String,
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
clubCreationRequestSchema.index({ foundingMembers: 1 });

module.exports = mongoose.model("ClubCreationRequest", clubCreationRequestSchema);
