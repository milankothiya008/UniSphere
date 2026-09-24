const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, ACCOUNT_TYPES, USER_PUBLIC_FIELDS } = require("../constants/Roles");
const { AUDIT_ACTIONS } = require("../constants/Statuses");
const { hashPassword, comparePassword } = require("../utils/Password");
const {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    hashToken,
    generateRawToken,
    generateOtp,
    hashOtp,
    otpMatches,
    OTP_LENGTH,
    refreshTokenTtlMs
} = require("../utils/Token");
const {
    classifyUniversityEmail,
    isUniversityEmail,
    isValidUniversityEmailFormat,
    parseStudentEmail,
    parseFacultyEmail,
    EMAIL_FORMAT_HINT,
    STUDENT_FORMAT_HINT,
    FACULTY_FORMAT_HINT
} = require("../utils/UniversityRules");
const { env } = require("../config/env");
const logger = require("../utils/Logger");
const { sendVerificationCode, sendPasswordResetCode } = require("./MailService");
const { recordAudit } = require("./AuditService");

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
// Once the reset code is confirmed, the user has this long to choose a new password.
const RESET_SESSION_TTL_MINUTES = 15;

// Static, so returning it reveals nothing about whether an account exists.
const OTP_POLICY = Object.freeze({
    length: OTP_LENGTH,
    expiresInMinutes: OTP_TTL_MINUTES,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS
});

const OTP_FIELDS = {
    verification: {
        hash: "emailVerificationCodeHash",
        expires: "emailVerificationCodeExpires",
        attempts: "emailVerificationAttempts",
        sentAt: "emailVerificationSentAt"
    },
    reset: {
        hash: "passwordResetCodeHash",
        expires: "passwordResetCodeExpires",
        attempts: "passwordResetAttempts",
        sentAt: "passwordResetSentAt"
    }
};
// A rotated refresh token presented again within this window is treated as a concurrent
// refresh (two tabs, double effects) rather than theft, so the token family is not revoked.
const REFRESH_REUSE_GRACE_MS = 10 * 1000;

const PRIVATE_FIELDS = [
    "password",
    ...Object.values(OTP_FIELDS.verification),
    ...Object.values(OTP_FIELDS.reset),
    "passwordResetTokenHash",
    "passwordResetExpires"
];

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const selectOtpFields = (purpose) =>
    Object.values(OTP_FIELDS[purpose])
        .map((field) => `+${field}`)
        .join(" ");

// Sets a fresh code on the document (the caller saves it) and returns the plain code for the email.
const issueOtp = (user, purpose) => {
    const fields = OTP_FIELDS[purpose];
    const code = generateOtp();
    user[fields.hash] = hashOtp(user._id, code);
    user[fields.expires] = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    user[fields.attempts] = 0;
    user[fields.sentAt] = new Date();
    return code;
};

const clearOtp = (user, purpose) => {
    const fields = OTP_FIELDS[purpose];
    user[fields.hash] = null;
    user[fields.expires] = null;
    user[fields.attempts] = 0;
};

const recentlySent = (user, purpose) => {
    const sentAt = user[OTP_FIELDS[purpose].sentAt];
    return Boolean(sentAt) && Date.now() - sentAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000;
};

// Each guess is counted atomically before it is checked, so parallel requests cannot exceed the attempt limit.
// On success the code is cleared on the returned document; the caller saves it.
const consumeOtp = async (email, code, purpose) => {
    const fields = OTP_FIELDS[purpose];
    const user = await User.findOneAndUpdate(
        {
            email: normalizeEmail(email),
            [fields.hash]: { $ne: null },
            [fields.expires]: { $gt: new Date() },
            [fields.attempts]: { $lt: OTP_MAX_ATTEMPTS }
        },
        { $inc: { [fields.attempts]: 1 } },
        { returnDocument: "after" }
    ).select(selectOtpFields(purpose));

    if (!user) {
        throw new AppError("This code has expired or is no longer valid. Request a new code.", 400, ERROR_CODES.OTP_EXPIRED);
    }

    if (!otpMatches(user._id, String(code || ""), user[fields.hash])) {
        const attemptsLeft = OTP_MAX_ATTEMPTS - user[fields.attempts];

        if (attemptsLeft <= 0) {
            clearOtp(user, purpose);
            await user.save();
            throw new AppError("Too many incorrect attempts. Request a new code.", 400, ERROR_CODES.OTP_EXPIRED);
        }

        throw new AppError(
            `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
            400,
            ERROR_CODES.OTP_INVALID,
            { attemptsLeft }
        );
    }

    clearOtp(user, purpose);
    return user;
};

const sanitizeUser = (user) => {
    if (!user) {
        return null;
    }

    const obj = user.toObject ? user.toObject() : { ...user };
    PRIVATE_FIELDS.forEach((field) => delete obj[field]);
    delete obj.__v;
    return obj;
};

const assertPasswordStrength = (password) => {
    const value = String(password || "");
    if (value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
        throw new AppError(
            "Password must be at least 8 characters and include a letter and a number",
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
};

const issueTokens = async (user, userAgent) => {
    const accessToken = signAccessToken({
        sub: user._id.toString(),
        role: user.globalRole
    });

    const refreshToken = signRefreshToken({
        sub: user._id.toString(),
        jti: generateRawToken()
    });

    await RefreshToken.create({
        user: user._id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTokenTtlMs()),
        userAgent: userAgent ? String(userAgent).slice(0, 300) : null
    });

    return { accessToken, refreshToken };
};

const cookieOptions = () => ({
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSecure ? "none" : "lax",
    path: "/api/auth"
});

const setRefreshCookie = (res, refreshToken) => {
    res.cookie("refreshToken", refreshToken, { ...cookieOptions(), maxAge: refreshTokenTtlMs() });
};

const clearRefreshCookie = (res) => {
    res.clearCookie("refreshToken", cookieOptions());
};

// The selected role decides which email rule applies, so the user gets a message for the format they meant.
const assertEmailMatchesRole = (email, accountType) => {
    if (!isUniversityEmail(email)) {
        throw new AppError(`Use your @${env.universityDomain} university email`, 400, ERROR_CODES.INVALID_EMAIL);
    }

    if (accountType === ACCOUNT_TYPES.STUDENT && !parseStudentEmail(email)) {
        const hint = parseFacultyEmail(email) ? " This looks like a faculty email — choose Faculty instead." : "";
        throw new AppError(`${STUDENT_FORMAT_HINT}.${hint}`, 400, ERROR_CODES.INVALID_EMAIL);
    }

    if (accountType === ACCOUNT_TYPES.FACULTY && !parseFacultyEmail(email)) {
        const hint = parseStudentEmail(email) ? " This looks like a student email — choose Student instead." : "";
        throw new AppError(`${FACULTY_FORMAT_HINT}.${hint}`, 400, ERROR_CODES.INVALID_EMAIL);
    }
};

const register = async ({ name, email, password, accountType }) => {
    if (!name || !email || !password) {
        throw new AppError("Name, email and password are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (!Object.values(ACCOUNT_TYPES).includes(accountType)) {
        throw new AppError("Choose whether you are registering as a student or faculty", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    assertPasswordStrength(password);

    const normalizedEmail = normalizeEmail(email);
    assertEmailMatchesRole(normalizedEmail, accountType);
    const classified = await classifyUniversityEmail(normalizedEmail);
    const existing = await User.findOne({ email: normalizedEmail });

    if (existing && !existing.isEmailVerified) {
        throw new AppError(
            "An account with this email is waiting for verification. Enter the code we emailed you, or request a new one.",
            409,
            ERROR_CODES.UNVERIFIED_EMAIL
        );
    }

    if (existing) {
        throw new AppError("An account with this email already exists", 409, ERROR_CODES.CONFLICT);
    }

    // The system role is derived from the verified email format, never from client input.
    const user = new User({
        name: String(name).trim(),
        email: normalizedEmail,
        password: await hashPassword(password),
        accountType: classified.accountType,
        globalRole: classified.accountType === ACCOUNT_TYPES.FACULTY ? GLOBAL_ROLES.FACULTY : GLOBAL_ROLES.STUDENT,
        departmentCode: classified.departmentCode,
        batchCode: classified.batchCode,
        isEmailVerified: false
    });
    const code = issueOtp(user, "verification");
    await user.save();

    await sendVerificationCode(user, code, OTP_TTL_MINUTES);

    await recordAudit({
        action: AUDIT_ACTIONS.USER_REGISTERED,
        actor: user._id,
        targetType: "User",
        targetId: user._id,
        metadata: { accountType: user.accountType }
    });

    return { user: sanitizeUser(user), otp: OTP_POLICY };
};

const verifyEmail = async ({ email, code }) => {
    const user = await consumeOtp(email, code, "verification");

    user.isEmailVerified = true;
    await user.save();

    return sanitizeUser(user);
};

// Responds identically whether or not the account exists, to avoid account enumeration.
const resendVerification = async (email) => {
    const user = await User.findOne({ email: normalizeEmail(email) }).select(selectOtpFields("verification"));

    if (!user || user.isEmailVerified || !user.isActive || recentlySent(user, "verification")) {
        return OTP_POLICY;
    }

    const code = issueOtp(user, "verification");
    await user.save();

    await sendVerificationCode(user, code, OTP_TTL_MINUTES);
    return OTP_POLICY;
};

const login = async ({ email, password }, userAgent) => {
    if (!email || !password) {
        throw new AppError("Email and password are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // A format check reveals nothing about which accounts exist, so it can fail fast with a helpful message.
    if (!isValidUniversityEmailFormat(normalizedEmail)) {
        throw new AppError(`Sign in with your university email: ${EMAIL_FORMAT_HINT}`, 400, ERROR_CODES.INVALID_EMAIL);
    }

    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user || !(await comparePassword(String(password), user.password))) {
        logger.warn("Authentication failure", { email: normalizedEmail });
        throw new AppError("Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
        throw new AppError("Your account has been disabled. Contact the university admin.", 403, ERROR_CODES.ACCOUNT_DISABLED);
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
    } catch {
        throw new AppError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
    }

    const tokenHash = hashToken(incomingToken);
    const stored = await RefreshToken.findOne({ tokenHash, user: decoded.sub });

    if (!stored) {
        throw new AppError("Refresh token has been revoked", 401, ERROR_CODES.REFRESH_REVOKED);
    }

    if (stored.revokedAt) {
        const rotatedRecently =
            stored.replacedByTokenHash && Date.now() - stored.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;

        if (!rotatedRecently) {
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

    // Claim the token atomically so two concurrent refreshes cannot both rotate it.
    const claimed = await RefreshToken.findOneAndUpdate(
        { _id: stored._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }
    );

    if (!claimed) {
        throw new AppError("Refresh token has been revoked", 401, ERROR_CODES.REFRESH_REVOKED);
    }

    const tokens = await issueTokens(user, userAgent);
    await RefreshToken.updateOne({ _id: stored._id }, { $set: { replacedByTokenHash: hashToken(tokens.refreshToken) } });

    return { user: sanitizeUser(user), ...tokens };
};

const logout = async (incomingToken) => {
    if (!incomingToken) {
        return;
    }

    await RefreshToken.updateOne(
        { tokenHash: hashToken(incomingToken), revokedAt: null },
        { revokedAt: new Date() }
    );
};

const logoutAll = async (userId) => {
    await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
};

// Responds identically whether or not the account exists, to avoid account enumeration.
const forgotPassword = async (email) => {
    const user = await User.findOne({ email: normalizeEmail(email) }).select(selectOtpFields("reset"));

    if (!user || !user.isActive || recentlySent(user, "reset")) {
        return OTP_POLICY;
    }

    const code = issueOtp(user, "reset");
    await user.save();

    await sendPasswordResetCode(user, code, OTP_TTL_MINUTES);
    return OTP_POLICY;
};

// Exchanges a correct reset code for a short-lived token that authorises setting the new password.
// The token goes only to the client that proved the code, never into an email or URL.
const verifyResetCode = async ({ email, code }) => {
    const user = await consumeOtp(email, code, "reset");

    if (!user.isActive) {
        await user.save();
        throw new AppError("Your account has been disabled. Contact the university admin.", 403, ERROR_CODES.ACCOUNT_DISABLED);
    }

    const resetToken = generateRawToken();
    user.passwordResetTokenHash = hashToken(resetToken);
    user.passwordResetExpires = new Date(Date.now() + RESET_SESSION_TTL_MINUTES * 60 * 1000);
    await user.save();

    return { resetToken, expiresInMinutes: RESET_SESSION_TTL_MINUTES };
};

const resetPassword = async (token, password) => {
    if (!token) {
        throw new AppError("Your reset session is missing. Start the password reset again.", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    assertPasswordStrength(password);

    const user = await User.findOne({
        passwordResetTokenHash: hashToken(String(token)),
        passwordResetExpires: { $gt: new Date() }
    }).select("+passwordResetTokenHash +passwordResetExpires");

    if (!user) {
        throw new AppError("Your reset session has expired. Start the password reset again.", 400, ERROR_CODES.TOKEN_INVALID);
    }

    user.password = await hashPassword(password);
    user.passwordResetTokenHash = null;
    user.passwordResetExpires = null;
    // Entering the emailed reset code proves ownership of the address.
    user.isEmailVerified = true;
    await user.save();

    await logoutAll(user._id);

    await recordAudit({
        action: AUDIT_ACTIONS.PASSWORD_RESET,
        actor: user._id,
        targetType: "User",
        targetId: user._id
    });
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
    const user = await User.findById(userId).select("+password");

    if (!user || !(await comparePassword(String(currentPassword || ""), user.password))) {
        throw new AppError("Current password is incorrect", 400, ERROR_CODES.INVALID_CREDENTIALS);
    }

    assertPasswordStrength(newPassword);

    user.password = await hashPassword(newPassword);
    await user.save();
    await logoutAll(user._id);
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
    forgotPassword,
    verifyResetCode,
    resetPassword,
    changePassword,
    getMe,
    setRefreshCookie,
    clearRefreshCookie,
    sanitizeUser,
    issueTokens
};
