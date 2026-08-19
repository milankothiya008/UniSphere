const User = require("../models/User");

const createUser = async (userData) => {
    return await User.create(userData);
};

const getAllUsers = async () => {
    return await User.find();
};

const getUserById = async (id) => {
    return await User.findById(id);
};

const updateUser = async (id, userData) => {
    return await User.findByIdAndUpdate(
        id,
        userData,
        {
            new: true,
            runValidators: true
        }
    );
};

const deleteUser = async (id) => {
    return await User.findByIdAndDelete(id);
};

module.exports = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser
};