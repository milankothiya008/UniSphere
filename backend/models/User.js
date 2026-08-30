const mongoose = require("mongoose");
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
        emailVerificationTokenHash: {
            type: String,
            select: false,
            default: null
        },
        emailVerificationExpires: {
            type: Date,
            select: false,
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

userSchema.index({ globalRole: 1 });
userSchema.index({ departmentCode: 1 });

module.exports = mongoose.model("User", userSchema);
