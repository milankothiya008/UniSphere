const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const logger = require("../utils/Logger");

const handleCastError = (err) => {
    return new AppError(`Invalid ${err.path}: ${err.value}`, 400, ERROR_CODES.VALIDATION_ERROR);
};

const handleDuplicateKeyError = (err) => {
    const field = Object.keys(err.keyValue || {})[0];
    const value = err.keyValue ? err.keyValue[field] : "";

    return new AppError(
        `Duplicate value '${value}' for field '${field}'. Please use another value.`,
        409,
        ERROR_CODES.CONFLICT
    );
};

const handleValidationError = (err) => {
    const messages = Object.values(err.errors || {}).map((e) => e.message);

    return new AppError(
        `Validation failed: ${messages.join(". ")}`,
        400,
        ERROR_CODES.VALIDATION_ERROR
    );
};

const handleJwtError = () => {
    return new AppError("Invalid or expired token", 401, ERROR_CODES.TOKEN_INVALID);
};

const sendError = (err, res, isProduction) => {
    const body = {
        success: false,
        status: err.status || "error",
        message: err.message,
        errorCode: err.errorCode || null
    };

    if (!isProduction) {
        body.stack = err.stack;
    }

    if (err.isOperational) {
        return res.status(err.statusCode || 500).json(body);
    }

    logger.error("Unhandled error", { message: err.message, name: err.name });

    return res.status(500).json({
        success: false,
        status: "error",
        message: isProduction ? "Something went wrong" : err.message,
        errorCode: null
    });
};

const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    const isProduction = process.env.NODE_ENV === "production";
    let error = err;

    if (err.name === "CastError") {
        error = handleCastError(err);
    } else if (err.code === 11000) {
        error = handleDuplicateKeyError(err);
    } else if (err.name === "ValidationError") {
        error = handleValidationError(err);
    } else if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
        error = handleJwtError();
    }

    sendError(error, res, isProduction);
};

module.exports = errorHandler;
