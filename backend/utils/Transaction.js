const logger = require("./Logger");

const withTransaction = async (work) => {
    const mongoose = require("mongoose");

    if (mongoose.connection.readyState !== 1) {
        return work(null);
    }

    try {
        const session = await mongoose.startSession();

        try {
            let result;
            await session.withTransaction(async () => {
                result = await work(session);
            });
            return result;
        } finally {
            session.endSession();
        }
    } catch (error) {
        const message = String(error.message || "");
        const standalone =
            message.includes("Transaction numbers are only allowed") ||
            message.includes("replica set") ||
            error.code === 20;

        if (standalone) {
            logger.warn("MongoDB transactions unavailable; continuing without a session");
            return work(null);
        }

        throw error;
    }
};

const maybeSession = (session) => (session ? { session } : {});

module.exports = { withTransaction, maybeSession };
