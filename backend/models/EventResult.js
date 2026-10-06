const mongoose = require("mongoose");
const { clearOnWrite } = require("../utils/TtlCache");
const { eventFeedCache } = require("../utils/Caches");
const { RESULT_STATUS } = require("../constants/Statuses");

const awardSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true, maxlength: 120 },
        position: { type: Number, default: null, min: 1 },
        recipientName: { type: String, default: null, trim: true, maxlength: 120 },
        recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        teamName: { type: String, default: null, trim: true, maxlength: 120 },
        prize: { type: String, default: null, trim: true, maxlength: 200 },
        recognition: { type: String, default: null, trim: true, maxlength: 300 }
    },
    { _id: true }
);

// One line of a round's standings: a participant or team, where they placed and whether they go through.
const entrySchema = new mongoose.Schema(
    {
        rank: { type: Number, default: null, min: 1 },
        recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        recipientName: { type: String, default: null, trim: true, maxlength: 120 },
        teamName: { type: String, default: null, trim: true, maxlength: 120 },
        score: { type: String, default: null, trim: true, maxlength: 40 },
        // true = qualified for the next round, false = eliminated, null = not applicable.
        qualified: { type: Boolean, default: null },
        note: { type: String, default: null, trim: true, maxlength: 200 }
    },
    { _id: true }
);

// A stage of a multi-round event (screening, semi-final…). Each round is published on its own,
// so results can go out while the event is still running.
const roundSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, default: "", trim: true, maxlength: 1000 },
        entries: { type: [entrySchema], default: [] },
        status: { type: String, enum: Object.values(RESULT_STATUS), default: RESULT_STATUS.DRAFT },
        publishedAt: { type: Date, default: null },
        publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        // Set when the president edits a round after publishing it.
        correctedAt: { type: Date, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
    },
    { _id: true, timestamps: true }
);

// Everything about one event's results: its rounds, and the final results (summary + awards).
// `status`/`publishedAt` describe the final results; rounds carry their own.
const eventResultSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true,
            unique: true
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        summary: {
            type: String,
            trim: true,
            maxlength: 4000,
            default: ""
        },
        awards: {
            type: [awardSchema],
            default: []
        },
        rounds: {
            type: [roundSchema],
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
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        publishedAt: {
            type: Date,
            default: null
        },
        publishedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        // Set when the president corrects final results after publishing them.
        correctedAt: {
            type: Date,
            default: null
        },
        // Most recent publication of anything (a round or the final results); orders the Results page.
        lastPublishedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

eventResultSchema.index({ status: 1, publishedAt: -1 });
eventResultSchema.index({ club: 1, status: 1 });
eventResultSchema.index({ lastPublishedAt: -1 });

// Any write refreshes the cached events feed (utils/Caches.js).
clearOnWrite(eventResultSchema, () => eventFeedCache.clear());

module.exports = mongoose.model("EventResult", eventResultSchema);
