const mongoose = require("mongoose");

// One chat message. Attachments keep only storage details (see ChatMediaService); URLs are built on read.

// POLL: a club election card in the club group (the election itself lives in ClubElection).
const MESSAGE_TYPES = Object.freeze({ TEXT: "TEXT", MEDIA: "MEDIA", FILE: "FILE", VOICE: "VOICE", SYSTEM: "SYSTEM", POLL: "POLL" });

const attachmentSchema = new mongoose.Schema(
    {
        kind: { type: String, enum: ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"], required: true },
        provider: { type: String, required: true },
        key: { type: String, required: true },
        version: { type: Number, default: null },
        format: { type: String, default: null },
        width: { type: Number, default: null },
        height: { type: Number, default: null },
        duration: { type: Number, default: null },
        bytes: { type: Number, default: null },
        name: { type: String, maxlength: 160, default: "" }
    },
    { _id: false }
);

const messageSchema = new mongoose.Schema(
    {
        conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        type: { type: String, enum: Object.values(MESSAGE_TYPES), default: MESSAGE_TYPES.TEXT },
        text: { type: String, maxlength: 4000, default: "" },
        attachments: { type: [attachmentSchema], default: [] },
        // A preview card for the first link in the text, filled in after sending.
        link: {
            type: new mongoose.Schema(
                { url: String, title: String, description: String, image: String, site: String },
                { _id: false }
            ),
            default: null
        },
        replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
        // POLL messages: the election shown as a card.
        poll: { type: mongoose.Schema.Types.ObjectId, ref: "ClubElection", default: null },
        forwarded: { type: Boolean, default: false },
        reactions: { type: [new mongoose.Schema({ user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, emoji: String }, { _id: false })], default: [] },
        // The sender's own id for this message, so a resend after a dropped connection isn't stored twice.
        clientId: { type: String, maxlength: 64, default: null },
        editedAt: { type: Date, default: null },
        // Unsent for everyone: the text and files are removed, a placeholder stays.
        deletedAt: { type: Date, default: null },
        // Deleted for these people only.
        hiddenFor: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
        // SYSTEM messages: "Asha added Bina", "Group renamed to …".
        system: { type: new mongoose.Schema({ action: String, actor: String, target: String }, { _id: false }), default: null }
    },
    { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, sender: 1, clientId: 1 }, { unique: true, partialFilterExpression: { clientId: { $type: "string" } } });

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
module.exports.MESSAGE_TYPES = MESSAGE_TYPES;
