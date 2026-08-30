const User = require("../models/User");
const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/AsyncHandler");
const ERROR_CODES = require("../constants/ErrorCodes");
const { USER_PUBLIC_FIELDS } = require("../constants/Roles");
const { verifyAccessToken } = require("../utils/Token");

const protect = asyncHandler(async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        throw new AppError("Authentication required", 401, ERROR_CODES.UNAUTHORIZED);
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.sub).select(USER_PUBLIC_FIELDS + " isActive");

    if (!user || !user.isActive) {
        throw new AppError("Authentication required", 401, ERROR_CODES.UNAUTHORIZED);
    }

    req.user = user;
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

module.exports = { protect, requireVerified, restrictTo };
