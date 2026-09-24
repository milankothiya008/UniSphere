const mongoose = require("mongoose");
const { CLUB_STATUS } = require("../constants/Statuses");
const { CLUB_CATEGORIES } = require("../constants/Categories");

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
            enum: CLUB_CATEGORIES
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
        logo: {
            type: String,
            default: null
        },
        contactEmail: {
            type: String,
            trim: true,
            lowercase: true,
            default: null
        },
        // Public profile details kept up to date by the club's leadership.
        tagline: {
            type: String,
            trim: true,
            maxlength: 140,
            default: ""
        },
        coverImage: {
            type: String,
            default: null
        },
        website: {
            type: String,
            trim: true,
            default: null
        },
        contactPhone: {
            type: String,
            trim: true,
            maxlength: 20,
            default: null
        },
        // Keys come from utils/ClubLinks SOCIAL_PLATFORMS; links are validated before saving.
        socialLinks: {
            instagram: { type: String, default: null },
            linkedin: { type: String, default: null },
            x: { type: String, default: null },
            youtube: { type: String, default: null },
            facebook: { type: String, default: null },
            github: { type: String, default: null },
            discord: { type: String, default: null },
            whatsapp: { type: String, default: null }
        },
        meetingSchedule: {
            type: String,
            trim: true,
            maxlength: 120,
            default: ""
        },
        meetingLocation: {
            type: String,
            trim: true,
            maxlength: 120,
            default: ""
        },
        mentor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
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
            default: CLUB_STATUS.APPROVED
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
clubSchema.index({ departmentCodes: 1, status: 1 });
clubSchema.index({ mentor: 1 });

module.exports = mongoose.model("Club", clubSchema);
