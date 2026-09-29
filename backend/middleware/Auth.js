const User = require("../models/User");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/AsyncHandler");
const ERROR_CODES = require("../constants/ErrorCodes");
const { USER_PUBLIC_FIELDS } = require("../constants/Roles");
const { verifyAccessToken } = require("../utils/Token");
const { userCache } = require("../utils/Caches");

const readBearer = (req) => {
    const header = req.headers.authorization;
    return header && header.startsWith("Bearer ") ? header.split(" ")[1] : null;
};

// The user comes from a short-lived cache that every write to a user clears, so role changes and
// deactivation still apply immediately while most requests skip a database round trip.
const loadUser = async (token) => {
    const decoded = verifyAccessToken(token);
    const cached = await userCache.remember(String(decoded.sub), async () => {
        const found = await User.findById(decoded.sub).select(USER_PUBLIC_FIELDS).lean();
        return found || null;
    });
    // Each request gets its own document, so nothing a request does to it leaks into another.
    const user = cached ? User.hydrate(cached) : null;

    if (!user || !user.isActive) {
        throw new AppError("Authentication required", 401, ERROR_CODES.UNAUTHORIZED);
    }

    return user;
};

const protect = asyncHandler(async (req, res, next) => {
    const token = readBearer(req);

    if (!token) {
        throw new AppError("Authentication required", 401, ERROR_CODES.UNAUTHORIZED);
    }

    req.user = await loadUser(token);
    next();
});

// Attaches the user when a token is sent; anonymous requests continue. An invalid or
// expired token still fails with 401 so the client knows to refresh it.
const optionalAuth = asyncHandler(async (req, res, next) => {
    const token = readBearer(req);

    if (token) {
        req.user = await loadUser(token);
    }

    next();
});

const requireVerified = (req, res, next) => {
    if (!req.user?.isEmailVerified) {
        return next(new AppError("Email verification required", 403, ERROR_CODES.UNVERIFIED_EMAIL));
    }
    next();
};

const restrictTo = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.globalRole)) {
        return next(new AppError("You do not have permission to perform this action", 403, ERROR_CODES.FORBIDDEN));
    }
    next();
};

module.exports = { protect, optionalAuth, requireVerified, restrictTo };
