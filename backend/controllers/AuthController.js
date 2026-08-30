const authService = require("../services/AuthService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const register = asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    sendSuccess(res, 201, "Registration successful. Please verify your email.", result);
});

const verifyEmail = asyncHandler(async (req, res) => {
    const user = await authService.verifyEmail(req.body.token || req.query.token);
    sendSuccess(res, 200, "Email verified successfully", user);
});

const resendVerification = asyncHandler(async (req, res) => {
    const result = await authService.resendVerification(req.body.email);
    sendSuccess(res, 200, "Verification email sent", result);
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
    const token = req.cookies.refreshToken || req.body.refreshToken;
    const result = await authService.refresh(token, req.get("user-agent"));
    authService.setRefreshCookie(res, result.refreshToken);
    sendSuccess(res, 200, "Token refreshed", {
        user: result.user,
        accessToken: result.accessToken
    });
});

const logout = asyncHandler(async (req, res) => {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    await authService.logout(token);
    authService.clearRefreshCookie(res);
    sendSuccess(res, 200, "Logged out successfully");
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
    me
};
