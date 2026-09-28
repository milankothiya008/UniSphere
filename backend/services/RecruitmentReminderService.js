const Club = require("../models/Club");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const Venue = require("../models/Venue");
const { env } = require("../config/env");
const logger = require("../utils/Logger");
const { APPLICATION_STATUS, RECRUITMENT_STATUS, ROUND_STATUS } = require("../constants/Statuses");
const { sendInterviewReminder } = require("./RecruitmentMailer");

// Interview reminders: 1 hour and 10 minutes before each candidate's time. A sweep runs every minute; each
// reminder is claimed atomically on the application before it's sent, so restarts or several servers never
// send it twice. A candidate scheduled at short notice simply gets the reminders that still make sense.

const SWEEP_EVERY_MS = 60 * 1000;
const MINUTE = 60 * 1000;

// minutesLeft in (15, 60] → the 1-hour reminder; (0, 10] → the 10-minute one.
const reminderFor = (startAt, now) => {
    const left = (new Date(startAt) - now) / MINUTE;
    if (left > 15 && left <= 60) {
        return { kind: "60m", minutes: 60 };
    }
    if (left > 0 && left <= 10) {
        return { kind: "10m", minutes: 10 };
    }
    return null;
};

const sweepInterviewReminders = async ({ now = new Date() } = {}) => {
    const applications = await RecruitmentApplication.find({
        status: { $in: [APPLICATION_STATUS.APPLIED, APPLICATION_STATUS.IN_ROUNDS] },
        slots: { $elemMatch: { startAt: { $gt: now, $lte: new Date(now.getTime() + 60 * MINUTE) } } }
    }).populate("applicant", "name email");
    if (!applications.length) {
        return 0;
    }

    const drives = await RecruitmentDrive.find({ _id: { $in: [...new Set(applications.map((item) => String(item.drive)))] }, status: RECRUITMENT_STATUS.PUBLISHED });
    const clubs = await Club.find({ _id: { $in: drives.map((drive) => drive.club) } }).select("name");
    const venues = new Map();
    let sent = 0;

    for (const application of applications) {
        const drive = drives.find((item) => String(item._id) === String(application.drive));
        if (!drive) {
            continue;
        }
        for (const slot of application.slots) {
            const round = drive.rounds.id(slot.round);
            const reminder = reminderFor(slot.startAt, now);
            if (!round || round.status !== ROUND_STATUS.SCHEDULED || !reminder) {
                continue;
            }
            // Claim it: only one sweep can add this (round, kind) pair.
            const claimed = await RecruitmentApplication.updateOne(
                { _id: application._id, remindersSent: { $not: { $elemMatch: { round: round._id, kind: reminder.kind } } } },
                { $push: { remindersSent: { round: round._id, kind: reminder.kind, at: now } } }
            );
            if (!claimed.modifiedCount) {
                continue;
            }
            if (round.venue && !venues.has(String(round.venue))) {
                venues.set(String(round.venue), await Venue.findById(round.venue).select("name location"));
            }
            const club = clubs.find((item) => String(item._id) === String(drive.club));
            await sendInterviewReminder(drive, club, round, slot, application.applicant, round.venue ? venues.get(String(round.venue)) : null, reminder.minutes);
            sent += 1;
        }
    }
    return sent;
};

let sweeper = null;
let sweeping = false;

const startInterviewReminderSweeper = () => {
    if (sweeper || env.isTest) {
        return;
    }
    const run = async () => {
        if (sweeping) {
            return;
        }
        sweeping = true;
        try {
            const sent = await sweepInterviewReminders();
            if (sent) {
                logger.info("Interview reminders sent", { count: sent });
            }
        } catch (error) {
            logger.error("Interview reminder sweep failed", { message: error.message });
        } finally {
            sweeping = false;
        }
    };
    run();
    sweeper = setInterval(run, SWEEP_EVERY_MS);
    sweeper.unref();
};

module.exports = { sweepInterviewReminders, startInterviewReminderSweeper, reminderFor };
