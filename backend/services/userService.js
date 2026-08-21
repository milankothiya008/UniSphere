const User = require("../models/User");
const AppError = require("../utils/AppError");

const ALLOWED_EMAIL_DOMAIN = "ddu.ac.in";


const createUser = async (userData) => {

    const { name, email, password } = userData;

    if (!name || !email || !password) {
        throw new AppError(
            "Name, email and password are required",
            400
        );
    }

    // Validate DDU college email
    if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
        throw new AppError(
            `Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed for registration`,
            400
        );
    }

    return await User.create(userData);
};


const getAllUsers = async () => {
    return await User.find();
};


const getUserById = async (id) => {
    const user = await User.findById(id);

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
};


const updateUser = async (id, userData) => {
    const user = await User.findByIdAndUpdate(
        id,
        userData,
        {
            new: true,
            runValidators: true
        }
    );

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
};


const deleteUser = async (id) => {
    const user = await User.findByIdAndDelete(id);

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
};


module.exports = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser
};