const mongoose = require("mongoose");
const { CLUB_STATUS } = require("../constants/Statuses");

const clubSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            unique: true,
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
            trim: true,
            default: ""
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
        departmentCode: {
            type: String,
            uppercase: true,
            default: null
        },
        logo: {
            type: String,
            default: null
        },
        president: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        status: {
            type: String,
            enum: Object.values(CLUB_STATUS),
            default: CLUB_STATUS.PENDING
        },
        creationRequest: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ClubCreationRequest",
            default: null
        }
    },
    { timestamps: true }
);

clubSchema.index({ status: 1 });
clubSchema.index({ departmentCode: 1, status: 1 });

module.exports = mongoose.model("Club", clubSchema);
