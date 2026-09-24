const levels = {
    error: "ERROR",
    warn: "WARN",
    info: "INFO"
};

const formatMeta = (meta) => {
    if (!meta || typeof meta !== "object") {
        return "";
    }

    const safe = { ...meta };
    delete safe.password;
    delete safe.refreshToken;
    delete safe.accessToken;
    delete safe.token;
    delete safe.authorization;

    return Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : "";
};

const quietInTests = process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS;

const log = (level, message, meta) => {
    if (quietInTests && level !== "error") {
        return;
    }

    const line = `[${new Date().toISOString()}] ${levels[level] || level} ${message}${formatMeta(meta)}`;

    if (level === "error") {
        console.error(line);
        return;
    }

    console.log(line);
};

const logger = {
    error: (message, meta) => log("error", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    info: (message, meta) => log("info", message, meta)
};

module.exports = logger;
