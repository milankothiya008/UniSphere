const authService = require("../services/AuthService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const register = asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    sendSuccess(res, 201, "Account created. Enter the verification code we sent to your university email.", result);
});

const verifyEmail = asyncHandler(async (req, res) => {
    const user = await authService.verifyEmail(req.body);
    sendSuccess(res, 200, "Email verified successfully. You can now sign in.", user);
});

const resendVerification = asyncHandler(async (req, res) => {
    const otp = await authService.resendVerification(req.body.email);
    sendSuccess(res, 200, "If an unverified account exists for this email, a new verification code has been sent.", { otp });
});

const login = asyncHandler(async (req, res) => {
    const result = await authService.login(req.body, req.get("user-agent"));
    authService.setRefreshCookie(res, result.refreshToken);
    sendSuccess(res, 200, "Login successful", {
        user: result.user,
        accessToken: result.accessToken
    });
});

const refresh = asyncHandler(async (req, res) => {
    const token = req.cookies.refreshToken || req.body?.refreshToken;
    const result = await authService.refresh(token, req.get("user-agent"));
    authService.setRefreshCookie(res, result.refreshToken);
    sendSuccess(res, 200, "Token refreshed", {
        user: result.user,
        accessToken: result.accessToken
    });
});

const logout = asyncHandler(async (req, res) => {
    const token = req.cookies.refreshToken || req.body?.refreshToken;
    await authService.logout(token);
    authService.clearRefreshCookie(res);
    sendSuccess(res, 200, "Logged out successfully");
});

const forgotPassword = asyncHandler(async (req, res) => {
    const otp = await authService.forgotPassword(req.body.email);
    sendSuccess(res, 200, "If an account exists for this email, a password reset code has been sent.", { otp });
});

const verifyResetCode = asyncHandler(async (req, res) => {
    const result = await authService.verifyResetCode(req.body);
    sendSuccess(res, 200, "Code confirmed. Choose a new password.", result);
});

const resetPassword = asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.password);
    authService.clearRefreshCookie(res);
    sendSuccess(res, 200, "Password updated. Please sign in with your new password.");
});

const changePassword = asyncHandler(async (req, res) => {
    await authService.changePassword(req.user._id, req.body);
    authService.clearRefreshCookie(res);
    sendSuccess(res, 200, "Password changed. Please sign in again.");
});

const me = asyncHandler(async (req, res) => {
    const user = await authService.getMe(req.user._id);
    sendSuccess(res, 200, "Current user fetched", user);
});

module.exports = {
    register,
    verifyEmail,
    resendVerification,
    login,
    refresh,
    logout,
    forgotPassword,
    verifyResetCode,
    resetPassword,
    changePassword,
    me
};
