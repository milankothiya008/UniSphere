const mongoose = require("mongoose");
const { MEMBERSHIP_STATUS } = require("../constants/Statuses");

const clubMembershipSchema = new mongoose.Schema(
    {
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        // Key of one of the club's roles (Club.roles); MEMBER when the student holds no role.
        role: {
            type: String,
            trim: true,
            default: "MEMBER"
        },
        status: {
            type: String,
            enum: Object.values(MEMBERSHIP_STATUS),
            default: MEMBERSHIP_STATUS.PENDING
        },
        requestMessage: {
            type: String,
            trim: true,
            maxlength: 500,
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
        decisionReason: {
            type: String,
            default: null
        },
        joinedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

clubMembershipSchema.index({ club: 1, user: 1 }, { unique: true });
clubMembershipSchema.index({ user: 1, status: 1 });
clubMembershipSchema.index({ club: 1, role: 1, status: 1 });
// A club has one president and at most one vice-president.
clubMembershipSchema.index(
    { club: 1, role: 1 },
    { name: "one_president_one_vice_president", unique: true, partialFilterExpression: { role: { $in: ["PRESIDENT", "VICE_PRESIDENT"] }, status: "APPROVED" } }
);

module.exports = mongoose.model("ClubMembership", clubMembershipSchema);
