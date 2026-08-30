const express = require("express");
const { register, verifyEmail, resendVerification, login, refresh, logout, me } = require("../controllers/AuthController");
const { protect } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { authLimiter } = require("../middleware/RateLimiter");
const { registerRules, loginRules } = require("../validators/RequestValidators");

const router = express.Router();

router.post("/register", authLimiter, registerRules, validate, register);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", authLimiter, resendVerification);
router.post("/login", authLimiter, loginRules, validate, login);
router.post("/refresh", authLimiter, refresh);
router.post("/logout", logout);
router.get("/me", protect, me);

module.exports = router;
