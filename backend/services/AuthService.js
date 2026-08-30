const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, USER_PUBLIC_FIELDS } = require("../constants/Roles");
const { hashPassword, comparePassword } = require("../utils/Password");
const {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    hashToken,
    generateRawToken,
    refreshTokenTtlMs
} = require("../utils/Token");
const { classifyUniversityEmail } = require("../utils/UniversityRules");
const { env } = require("../config/env");
const logger = require("../utils/Logger");

const sanitizeUser = (user) => {
    if (!user) {
        return null;
    }

    const obj = user.toObject ? user.toObject() : user;
    delete obj.password;
    delete obj.emailVerificationTokenHash;
    delete obj.emailVerificationExpires;
    return obj;
};

const issueTokens = async (user, userAgent) => {
    const accessToken = signAccessToken({
        sub: user._id.toString(),
        role: user.globalRole
    });

    const refreshToken = signRefreshToken({
        sub: user._id.toString()
    });

    await RefreshToken.create({
        user: user._id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlMs()),
        userAgent: userAgent || null
    });

    return { accessToken, refreshToken };
};

const setRefreshCookie = (res, refreshToken) => {
    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: env.cookieSecure ? "none" : "lax",
        maxAge: refreshTokenTtlMs(),
        path: "/api/auth"
    });
};

const clearRefreshCookie = (res) => {
    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: env.cookieSecure ? "none" : "lax",
        path: "/api/auth"
    });
};

const register = async ({ name, email, password }) => {
    if (!name || !email || !password) {
        throw new AppError("Name, email and password are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (String(password).length < 8) {
        throw new AppError("Password must be at least 8 characters", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const classified = await classifyUniversityEmail(email);
    const existing = await User.findOne({ email: email.toLowerCase() });

    if (existing) {
        throw new AppError("An account with this email already exists", 409, ERROR_CODES.CONFLICT);
    }

    const verificationToken = generateRawToken();

    const user = await User.create({
        name,
        email: email.toLowerCase(),
        password: await hashPassword(password),
        accountType: classified.accountType,
        globalRole: GLOBAL_ROLES.STUDENT,
        departmentCode: classified.departmentCode,
        batchCode: classified.batchCode,
        isEmailVerified: false,
        emailVerificationTokenHash: hashToken(verificationToken),
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    logger.info("User registered; verification token issued", { userId: String(user._id) });

    if (env.nodeEnv !== "production") {
        logger.info("Email verification token (dev only)", { email: user.email, token: verificationToken });
    }

    return {
        user: sanitizeUser(user),
        verificationToken: env.nodeEnv === "production" ? undefined : verificationToken
    };
};

const verifyEmail = async (token) => {
    if (!token) {
        throw new AppError("Verification token is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const user = await User.findOne({
        emailVerificationTokenHash: hashToken(token),
        emailVerificationExpires: { $gt: new Date() }
    }).select("+emailVerificationTokenHash +emailVerificationExpires");

    if (!user) {
        throw new AppError("Invalid or expired verification token", 400, ERROR_CODES.TOKEN_INVALID);
    }

    user.isEmailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpires = null;
    await user.save();

    return sanitizeUser(user);
};

const resendVerification = async (email) => {
    const user = await User.findOne({ email: String(email).toLowerCase() }).select(
        "+emailVerificationTokenHash +emailVerificationExpires"
    );

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (user.isEmailVerified) {
        throw new AppError("Email is already verified", 409, ERROR_CODES.CONFLICT);
    }

    const verificationToken = generateRawToken();
    user.emailVerificationTokenHash = hashToken(verificationToken);
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    if (env.nodeEnv !== "production") {
        logger.info("Email verification token resent (dev only)", { email: user.email, token: verificationToken });
    }

    return {
        verificationToken: env.nodeEnv === "production" ? undefined : verificationToken
    };
};

const login = async ({ email, password }, userAgent) => {
    if (!email || !password) {
        throw new AppError("Email and password are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const user = await User.findOne({ email: String(email).toLowerCase() }).select("+password");

    if (!user || !(await comparePassword(password, user.password))) {
        logger.warn("Authentication failure", { email: String(email).toLowerCase() });
        throw new AppError("Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
        throw new AppError("Account is disabled", 403, ERROR_CODES.FORBIDDEN);
    }

    if (!user.isEmailVerified) {
        throw new AppError("Please verify your email before logging in", 403, ERROR_CODES.UNVERIFIED_EMAIL);
    }

    const tokens = await issueTokens(user, userAgent);
    return { user: sanitizeUser(user), ...tokens };
};

const refresh = async (incomingToken, userAgent) => {
    if (!incomingToken) {
        throw new AppError("Refresh token is required", 401, ERROR_CODES.UNAUTHORIZED);
    }

    let decoded;
    try {
        decoded = verifyRefreshToken(incomingToken);
    } catch (error) {
        throw new AppError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
    }

    const tokenHash = hashToken(incomingToken);
    const stored = await RefreshToken.findOne({ tokenHash, user: decoded.sub });

    if (!stored || stored.revokedAt) {
        if (stored && stored.revokedAt) {
            await RefreshToken.updateMany({ user: decoded.sub, revokedAt: null }, { revokedAt: new Date() });
            logger.warn("Refresh token reuse detected; family revoked", { userId: decoded.sub });
        }
        throw new AppError("Refresh token has been revoked", 401, ERROR_CODES.REFRESH_REVOKED);
    }

    if (stored.expiresAt < new Date()) {
        throw new AppError("Refresh token has expired", 401, ERROR_CODES.TOKEN_EXPIRED);
    }

    const user = await User.findById(decoded.sub);

    if (!user || !user.isActive) {
        throw new AppError("User not found or inactive", 401, ERROR_CODES.UNAUTHORIZED);
    }

    stored.revokedAt = new Date();
    const tokens = await issueTokens(user, userAgent);
    stored.replacedByTokenHash = hashToken(tokens.refreshToken);
    await stored.save();

    return { user: sanitizeUser(user), ...tokens };
};

const logout = async (incomingToken) => {
    if (!incomingToken) {
        return;
    }

    const tokenHash = hashToken(incomingToken);
    await RefreshToken.updateOne(
        { tokenHash, revokedAt: null },
        { revokedAt: new Date() }
    );
};

const logoutAll = async (userId) => {
    await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
};

const getMe = async (userId) => {
    const user = await User.findById(userId).select(USER_PUBLIC_FIELDS);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return user;
};

module.exports = {
    register,
    verifyEmail,
    resendVerification,
    login,
    refresh,
    logout,
    logoutAll,
    getMe,
    setRefreshCookie,
    clearRefreshCookie,
    sanitizeUser
};
