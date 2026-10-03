const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { env } = require("../config/env");

// Many students share one campus NAT address, so limits are configurable per deployment.
// Signed-in limits count per person (a whole campus behind one address shouldn't share a quota);
// before sign-in they count per address.
const perUser = (req) => (req.user?._id ? `user:${req.user._id}` : ipKeyGenerator(req.ip));

const limiter = (max, message, { byUser = false } = {}) =>
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max,
        ...(byUser ? { keyGenerator: perUser } : {}),
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => env.isTest,
        message: {
            success: false,
            message,
            errorCode: "RATE_LIMITED"
        }
    });

const authLimiter = limiter(
    Number(process.env.AUTH_RATE_LIMIT) || 100,
    "Too many authentication attempts. Please try again later."
);

const apiLimiter = limiter(
    Number(process.env.API_RATE_LIMIT) || 2000,
    "Too many requests. Please slow down and try again shortly."
);

const uploadLimiter = limiter(Number(process.env.UPLOAD_RATE_LIMIT) || 120, "Too many uploads. Please try again later.", { byUser: true });

module.exports = { authLimiter, apiLimiter, uploadLimiter };
