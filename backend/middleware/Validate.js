const { validationResult } = require("express-validator");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");

const validate = (req, res, next) => {
    const errors = validationResult(req);

    if (errors.isEmpty()) {
        return next();
    }

    const message = errors
        .array()
        .map((item) => item.msg)
        .join(". ");

    next(new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR));
};

module.exports = validate;
