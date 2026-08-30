const AuditLog = require("../models/AuditLog");
const logger = require("../utils/Logger");

const recordAudit = async ({
    action,
    actor,
    targetType,
    targetId,
    fromState = null,
    toState = null,
    reason = null,
    metadata = {},
    session = null
}) => {
    const doc = {
        action,
        actor,
        targetType,
        targetId,
        fromState,
        toState,
        reason,
        metadata
    };

    if (session) {
        await AuditLog.create([doc], { session });
    } else {
        await AuditLog.create(doc);
    }

    logger.info(action, { targetType, targetId: String(targetId), fromState, toState });
};

module.exports = { recordAudit };
