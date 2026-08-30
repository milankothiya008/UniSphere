const mongoose = require("mongoose");

const academicBatchSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            match: [/^\d{2}$/, "Batch code must be a 2-digit year identifier"]
        },
        label: {
            type: String,
            required: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("AcademicBatch", academicBatchSchema);
