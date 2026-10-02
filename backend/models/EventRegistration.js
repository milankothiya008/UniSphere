const mongoose = require("mongoose");
const { REGISTRATION_STATUS, CHECK_IN_METHODS } = require("../constants/Statuses");
const { formAnswerSchema } = require("./FormSchemas");

const eventRegistrationSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        status: {
            type: String,
            enum: Object.values(REGISTRATION_STATUS),
            default: REGISTRATION_STATUS.REGISTERED
        },
        registeredAt: {
            type: Date,
            default: Date.now
        },
        // Queue order for WAITLISTED registrations (first in, first promoted).
        waitlistedAt: {
            type: Date,
            default: null
        },
        // Set when a waitlisted student was moved into a freed seat.
        promotedAt: {
            type: Date,
            default: null
        },
        // Team events: the team this registration belongs to. The leader's registration holds the team's
        // place (and its spot in the waitlist); members' registrations follow the leader's status.
        team: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Team",
            default: null
        },
        teamRole: {
            type: String,
            enum: ["LEADER", "MEMBER", null],
            default: null
        },
        // Answers to the event's registration form (the questions every member answers).
        answers: {
            type: [formAnswerSchema],
            default: []
        },
        // The ticket: a short code shown on the QR ticket (see utils/TicketToken). Issued whenever the
        // registration gets a place, and reissued on re-registration so an old QR stops working. Left unset
        // (not null) while waitlisted, so the partial unique index below ignores it.
        ticketCode: {
            type: String,
            trim: true,
            uppercase: true
        },
        ticketIssuedAt: {
            type: Date,
            default: null
        },
        // Attendance, recorded at the door by a club officer.
        checkedInAt: {
            type: Date,
            default: null
        },
        checkedInBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        checkInMethod: {
            type: String,
            enum: [...Object.values(CHECK_IN_METHODS), null],
            default: null
        },
        checkInNote: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        }
    },
    { timestamps: true }
);

eventRegistrationSchema.index({ event: 1, user: 1 }, { unique: true });
eventRegistrationSchema.index({ user: 1, status: 1 });
eventRegistrationSchema.index({ event: 1, status: 1 });
eventRegistrationSchema.index({ event: 1, status: 1, waitlistedAt: 1 });
eventRegistrationSchema.index({ team: 1, status: 1 });
eventRegistrationSchema.index({ ticketCode: 1 }, { unique: true, partialFilterExpression: { ticketCode: { $type: "string" } } });
eventRegistrationSchema.index({ event: 1, checkedInAt: 1 });

module.exports = mongoose.model("EventRegistration", eventRegistrationSchema);
