const mongoose = require("mongoose");
const { MEMBERSHIP_ROLES } = require("../constants/Roles");
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
        role: {
            type: String,
            enum: Object.values(MEMBERSHIP_ROLES),
            default: MEMBERSHIP_ROLES.MEMBER
        },
        status: {
            type: String,
            enum: Object.values(MEMBERSHIP_STATUS),
            default: MEMBERSHIP_STATUS.APPROVED
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

clubMembershipSchema.index({ club: 1, user: 1 }, { unique: true });
clubMembershipSchema.index({ user: 1, status: 1 });
clubMembershipSchema.index({ club: 1, role: 1, status: 1 });

module.exports = mongoose.model("ClubMembership", clubMembershipSchema);
