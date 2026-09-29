const mongoose = require("mongoose");
const { clearOnWrite } = require("../utils/TtlCache");
const { userCache } = require("../utils/Caches");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
            minlength: 2,
            maxlength: 80
        },
        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            lowercase: true,
            trim: true
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: 8,
            select: false
        },
        accountType: {
            type: String,
            enum: Object.values(ACCOUNT_TYPES),
            required: true
        },
        globalRole: {
            type: String,
            enum: Object.values(GLOBAL_ROLES),
            default: GLOBAL_ROLES.STUDENT
        },
        departmentCode: {
            type: String,
            uppercase: true,
            default: null
        },
        batchCode: {
            type: String,
            default: null
        },
        isEmailVerified: {
            type: Boolean,
            default: false
        },
        // One-time codes (OTP) emailed for verification and password reset. Only a hash is stored,
        // and a code dies after OTP_MAX_ATTEMPTS wrong guesses.
        emailVerificationCodeHash: {
            type: String,
            select: false,
            default: null
        },
        emailVerificationCodeExpires: {
            type: Date,
            select: false,
            default: null
        },
        emailVerificationAttempts: {
            type: Number,
            select: false,
            default: 0
        },
        emailVerificationSentAt: {
            type: Date,
            select: false,
            default: null
        },
        passwordResetCodeHash: {
            type: String,
            select: false,
            default: null
        },
        passwordResetCodeExpires: {
            type: Date,
            select: false,
            default: null
        },
        passwordResetAttempts: {
            type: Number,
            select: false,
            default: 0
        },
        passwordResetSentAt: {
            type: Date,
            select: false,
            default: null
        },
        // Short-lived token handed out once the reset code is confirmed; it authorises choosing the new password.
        passwordResetTokenHash: {
            type: String,
            select: false,
            default: null
        },
        passwordResetExpires: {
            type: Date,
            select: false,
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        },
        // Optional email categories (constants/EmailCategories). Account emails ignore these.
        emailPreferences: {
            clubUpdates: { type: Boolean, default: true },
            eventRecommendations: { type: Boolean, default: true },
            eventActivity: { type: Boolean, default: true },
            recruitment: { type: Boolean, default: true }
        }
    },
    { timestamps: true }
);

userSchema.index({ globalRole: 1 });
userSchema.index({ departmentCode: 1 });

// Any write to a user drops the cached copy used by the auth middleware.
clearOnWrite(userSchema, (target) => {
    const id = target?._id || target?.getQuery?.()?._id;
    if (id && typeof id !== "object") userCache.delete(String(id));
    else if (id && id._bsontype) userCache.delete(String(id));
    else userCache.clear();
});

module.exports = mongoose.model("User", userSchema);
