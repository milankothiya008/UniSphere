const express = require("express");

const {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser
} = require("../controllers/UserController");

const router = express.Router();

// Create user
router.post("/", createUser);

// Get all users
router.get("/", getAllUsers);

// Get user by ID
router.get("/:id", getUserById);

// Update user
router.put("/:id", updateUser);

// Delete user
router.delete("/:id", deleteUser);

module.exports = router;