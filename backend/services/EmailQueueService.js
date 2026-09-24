const EmailJob = require("../models/EmailJob");
const { EMAIL_JOB_STATUS, EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { deliver } = require("./MailService");
const { env } = require("../config/env");
const logger = require("../utils/Logger");

// Bulk email (event launches, results, announcements) is queued in MongoDB and sent in the
// background at a steady rate, so publishing never waits on SMTP, a restart loses nothing, and
// the SMTP provider's sending limits are respected. Failed sends are retried with back-off.
const TICK_MS = 5000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const STALE_LOCK_MS = 5 * 60 * 1000;
const INSERT_BATCH = 500;

const PRIORITY = { [EMAIL_CATEGORIES.ACCOUNT]: 1, [EMAIL_CATEGORIES.EVENT_ACTIVITY]: 3 };
const priorityFor = (category) => PRIORITY[category] ?? 5;

const isDuplicateKeyError = (error) => error?.code === 11000 || error?.writeErrors?.every?.((e) => e.code === 11000);

// jobs: [{ to, user, category, subject, html, text, headers, dedupeKey }]. Returns how many were queued.
const enqueueEmails = async (jobs) => {
    let queued = 0;
    for (let i = 0; i < jobs.length; i += INSERT_BATCH) {
        const batch = jobs.slice(i, i + INSERT_BATCH).map((job) => ({ ...job, priority: priorityFor(job.category) }));
        try {
            const inserted = await EmailJob.insertMany(batch, { ordered: false });
            queued += inserted.length;
        } catch (error) {
            // A repeated dedupeKey means that person already has this email queued or sent; skip it.
            if (!isDuplicateKeyError(error)) {
                logger.error("Failed to queue emails", { message: error.message });
            }
            queued += error.insertedDocs?.length ?? error.result?.insertedCount ?? 0;
        }
    }
    return queued;
};

const claimNext = (now) =>
    EmailJob.findOneAndUpdate(
        {
            $or: [
                { status: EMAIL_JOB_STATUS.PENDING, nextAttemptAt: { $lte: now } },
                { status: EMAIL_JOB_STATUS.SENDING, lockedAt: { $lte: new Date(now.getTime() - STALE_LOCK_MS) } }
            ]
        },
        { $set: { status: EMAIL_JOB_STATUS.SENDING, lockedAt: now }, $inc: { attempts: 1 } },
        { sort: { priority: 1, nextAttemptAt: 1 }, returnDocument: "after" }
    );

const sendJob = async (job) => {
    try {
        await deliver({
            to: job.to,
            subject: job.subject,
            html: job.html,
            text: job.text,
            headers: job.headers ? Object.fromEntries(job.headers) : undefined
        });
        const now = new Date();
        await EmailJob.updateOne(
            { _id: job._id },
            { $set: { status: EMAIL_JOB_STATUS.SENT, sentAt: now, finishedAt: now, lockedAt: null, lastError: null } }
        );
        return true;
    } catch (error) {
        const giveUp = job.attempts >= MAX_ATTEMPTS;
        const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)];
        await EmailJob.updateOne(
            { _id: job._id },
            {
                $set: {
                    status: giveUp ? EMAIL_JOB_STATUS.FAILED : EMAIL_JOB_STATUS.PENDING,
                    nextAttemptAt: new Date(Date.now() + delay),
                    finishedAt: giveUp ? new Date() : null,
                    lockedAt: null,
                    lastError: String(error.message || error).slice(0, 500)
                }
            }
        );
        logger[giveUp ? "error" : "warn"](giveUp ? "Email permanently failed" : "Email send failed; will retry", {
            to: job.to,
            subject: job.subject,
            attempt: job.attempts,
            message: error.message
        });
        return false;
    }
};

// Sends up to `limit` due emails, one at a time. Used by the worker and directly by tests.
const processEmailQueue = async ({ limit = 50 } = {}) => {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < limit; i += 1) {
        const job = await claimNext(new Date());
        if (!job) {
            break;
        }
        (await sendJob(job)) ? (sent += 1) : (failed += 1);
    }
    return { sent, failed };
};

let timer = null;
let running = false;

const startEmailWorker = () => {
    if (timer || env.isTest) {
        return;
    }

    // EMAIL_RATE_PER_MINUTE keeps bulk mail under the SMTP provider's limits (Gmail allows ~500 a day).
    const perTick = Math.max(1, Math.round((env.emailRatePerMinute * TICK_MS) / 60000));

    timer = setInterval(async () => {
        if (running) {
            return;
        }
        running = true;
        try {
            await processEmailQueue({ limit: perTick });
        } catch (error) {
            logger.error("Email worker error", { message: error.message });
        } finally {
            running = false;
        }
    }, TICK_MS);
    timer.unref?.();

    logger.info("Email queue worker started", { perMinute: env.emailRatePerMinute });
};

const stopEmailWorker = () => {
    clearInterval(timer);
    timer = null;
};

const emailQueueStats = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pending, sentToday, failedToday] = await Promise.all([
        EmailJob.countDocuments({ status: { $in: [EMAIL_JOB_STATUS.PENDING, EMAIL_JOB_STATUS.SENDING] } }),
        EmailJob.countDocuments({ status: EMAIL_JOB_STATUS.SENT, sentAt: { $gte: since } }),
        EmailJob.countDocuments({ status: EMAIL_JOB_STATUS.FAILED, finishedAt: { $gte: since } })
    ]);
    return { pending, sentToday, failedToday };
};

module.exports = { enqueueEmails, processEmailQueue, startEmailWorker, stopEmailWorker, emailQueueStats, MAX_ATTEMPTS };
