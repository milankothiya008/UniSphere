const mongoose = require("mongoose");
const logger = require("./Logger");

let supportsTransactions = null;

// Transactions need a replica set or sharded cluster. Detect this once, up front, so the unit
// of work never runs twice (a failed attempt followed by a retry would duplicate side effects).
const detectTransactionSupport = async () => {
    if (supportsTransactions !== null) {
        return supportsTransactions;
    }

    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        supportsTransactions = Boolean(hello.setName || hello.msg === "isdbgrid");
    } catch {
        supportsTransactions = false;
    }

    if (!supportsTransactions) {
        logger.warn("MongoDB transactions unavailable (standalone server); running without sessions");
    }

    return supportsTransactions;
};

const withTransaction = async (work) => {
    if (mongoose.connection.readyState !== 1 || !(await detectTransactionSupport())) {
        return work(null);
    }

    const session = await mongoose.startSession();

    try {
        let result;
        await session.withTransaction(async () => {
            result = await work(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
};

const maybeSession = (session) => (session ? { session } : {});

module.exports = { withTransaction, maybeSession };
