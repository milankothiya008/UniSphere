const mongoose = require("mongoose");

// A chat: one-to-one (DIRECT), a group someone created (GROUP), or a club's own group (CLUB).
//
// Members are embedded with their own read and notification state. For a CLUB chat, who belongs is decided
// by the club's approved memberships (the faculty mentor is not a member); entries here are only kept for
// people who have opened it, to remember what they've read.

const CONVERSATION_TYPES = Object.freeze({ DIRECT: "DIRECT", GROUP: "GROUP", CLUB: "CLUB" });
const MEMBER_ROLES = Object.freeze({ ADMIN: "ADMIN", MEMBER: "MEMBER" });

const memberSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        role: { type: String, enum: Object.values(MEMBER_ROLES), default: MEMBER_ROLES.MEMBER },
        // History is visible from here (when they were added, or when they cleared the chat).
        joinedAt: { type: Date, default: Date.now },
        clearedAt: { type: Date, default: null },
        lastReadAt: { type: Date, default: null },
        lastDeliveredAt: { type: Date, default: null },
        mutedUntil: { type: Date, default: null },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
    },
    { _id: false }
);

const mediaSchema = new mongoose.Schema(
    {
        kind: { type: String, required: true },
        provider: { type: String, required: true },
        key: { type: String, required: true },
        version: { type: Number, default: null },
        format: { type: String, default: null }
    },
    { _id: false }
);

const conversationSchema = new mongoose.Schema(
    {
        type: { type: String, enum: Object.values(CONVERSATION_TYPES), required: true },
        members: { type: [memberSchema], default: [] },
        // DIRECT: the two user ids, sorted and joined, so a pair only ever has one chat.
        directKey: { type: String, default: undefined },
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", default: undefined },
        name: { type: String, trim: true, maxlength: 80, default: "" },
        description: { type: String, trim: true, maxlength: 500, default: "" },
        avatar: { type: mediaSchema, default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        // Only admins may send (announcements).
        announceOnly: { type: Boolean, default: false },
        pinned: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }], default: [] },
        lastMessage: {
            message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
            sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            preview: { type: String, default: "" },
            // "Asha added Bina": shown without "You:" in the chat list.
            system: { type: Boolean, default: false },
            at: { type: Date, default: null }
        },
        lastMessageAt: { type: Date, default: null }
    },
    { timestamps: true }
);

conversationSchema.index({ directKey: 1 }, { unique: true, partialFilterExpression: { directKey: { $type: "string" } } });
conversationSchema.index({ club: 1 }, { unique: true, partialFilterExpression: { club: { $type: "objectId" } } });
conversationSchema.index({ "members.user": 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

module.exports = Conversation;
module.exports.CONVERSATION_TYPES = CONVERSATION_TYPES;
module.exports.MEMBER_ROLES = MEMBER_ROLES;
