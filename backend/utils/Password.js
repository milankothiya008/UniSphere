const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;

const hashPassword = async (plain) => bcrypt.hash(plain, SALT_ROUNDS);

const comparePassword = async (plain, hashed) => bcrypt.compare(plain, hashed);

module.exports = { hashPassword, comparePassword };
