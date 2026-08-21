const mongoose = require("mongoose");

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
            enum: [
                "PRESIDENT",
                "VICE_PRESIDENT",
                "COORDINATOR",
                "MEMBER"
            ],
            default: "MEMBER"
        },

        status: {
            type: String,
            enum: [
                "PENDING",
                "APPROVED",
                "REJECTED"
            ],
            default: "PENDING"
        },

        joinedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);


// Prevent duplicate membership
clubMembershipSchema.index(
    {
        club: 1,
        user: 1
    },
    {
        unique: true
    }
);


const ClubMembership = mongoose.model(
    "ClubMembership",
    clubMembershipSchema
);

module.exports = ClubMembership;