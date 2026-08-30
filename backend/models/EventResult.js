const mongoose = require("mongoose");
const { RESULT_STATUS } = require("../constants/Statuses");

const awardSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        rank: { type: Number, default: null },
        recipientName: { type: String, default: null, trim: true },
        recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        teamName: { type: String, default: null, trim: true },
        prize: { type: String, default: null, trim: true },
        remarks: { type: String, default: null, trim: true }
    },
    { _id: true }
);

const eventResultSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true,
            unique: true
        },
        summary: {
            type: String,
            required: true,
            trim: true,
            maxlength: 4000
        },
        awards: {
            type: [awardSchema],
            default: []
        },
        status: {
            type: String,
            enum: Object.values(RESULT_STATUS),
            default: RESULT_STATUS.DRAFT
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        publishedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("EventResult", eventResultSchema);
