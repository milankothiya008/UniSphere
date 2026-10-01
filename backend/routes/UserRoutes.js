const express = require("express");
const { getAllUsers, searchUsers, getUserById, getProfile, updateUser, setStatus } = require("../controllers/UserController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam, userStatusRules, userSearchRules } = require("../validators/RequestValidators");
const { body } = require("express-validator");

const router = express.Router();

router.use(protect, requireVerified);

router.get("/", restrictTo(GLOBAL_ROLES.ADMIN), getAllUsers);
router.get("/search", userSearchRules, validate, searchUsers);
router.get("/:id/profile", mongoIdParam("id"), validate, getProfile);
router.get("/:id", mongoIdParam("id"), validate, getUserById);
router.put(
    "/:id",
    mongoIdParam("id"),
    body("name").optional().isString().trim().isLength({ min: 2, max: 80 }).withMessage("Name must be 2-80 characters"),
    body("phone").optional({ values: "null" }).isString().isLength({ max: 20 }).withMessage("Enter a valid 10-digit Indian mobile number"),
    validate,
    updateUser
);
router.patch("/:id/status", restrictTo(GLOBAL_ROLES.ADMIN), mongoIdParam("id"), userStatusRules, validate, setStatus);

module.exports = router;
