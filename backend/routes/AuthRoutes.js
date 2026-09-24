const express = require("express");
const {
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
} = require("../controllers/AuthController");
const { protect } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { authLimiter } = require("../middleware/RateLimiter");
const {
    registerRules,
    loginRules,
    emailRules,
    otpRules,
    resetPasswordRules,
    changePasswordRules
} = require("../validators/RequestValidators");

const router = express.Router();

router.post("/register", authLimiter, registerRules, validate, register);
router.post("/verify-email", authLimiter, otpRules, validate, verifyEmail);
router.post("/resend-verification", authLimiter, emailRules, validate, resendVerification);
router.post("/login", authLimiter, loginRules, validate, login);
router.post("/refresh", authLimiter, refresh);
router.post("/logout", logout);
router.post("/forgot-password", authLimiter, emailRules, validate, forgotPassword);
router.post("/verify-reset-code", authLimiter, otpRules, validate, verifyResetCode);
router.post("/reset-password", authLimiter, resetPasswordRules, validate, resetPassword);
router.post("/change-password", protect, changePasswordRules, validate, changePassword);
router.get("/me", protect, me);

module.exports = router;
