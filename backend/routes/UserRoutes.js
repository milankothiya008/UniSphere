const express = require("express");
const { getAllUsers, getUserById, updateUser } = require("../controllers/UserController");
const { protect, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();

router.use(protect);

router.get("/", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), getAllUsers);
router.get("/:id", mongoIdParam("id"), validate, getUserById);
router.put("/:id", mongoIdParam("id"), validate, updateUser);

module.exports = router;
