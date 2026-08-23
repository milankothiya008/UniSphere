const AppError = require("../utils/AppError");


// Handle Mongoose CastError (invalid ObjectId)
const handleCastError = (err) => {
    return new AppError(
        `Invalid ${err.path}: ${err.value}`,
        400
    );
};


// Handle Mongoose duplicate key error
const handleDuplicateKeyError = (err) => {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];

    return new AppError(
        `Duplicate value '${value}' for field '${field}'. Please use another value.`,
        409
    );
};


// Handle Mongoose validation error
const handleValidationError = (err) => {
    const messages = Object.values(err.errors)
        .map((e) => e.message);

    return new AppError(
        `Validation failed: ${messages.join(". ")}`,
        400
    );
};


// Send error in development
const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        success: false,
        status: err.status,
        message: err.message,
        error: err,
        stack: err.stack
    });
};


// Send error in production
const sendErrorProd = (err, res) => {
    // Operational errors: send meaningful message to client
    if (err.isOperational) {
        res.status(err.statusCode).json({
            success: false,
            status: err.status,
            message: err.message
        });
    } else {
        // Programming/unknown errors: don't leak details
        console.error("ERROR:", err);

        res.status(500).json({
            success: false,
            status: "error",
            message: "Something went wrong"
        });
    }
};


// Global error handling middleware
const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    if (process.env.NODE_ENV === "production") {
        let error = Object.create(err);

        if (err.name === "CastError") {
            error = handleCastError(err);
        }

        if (err.code === 11000) {
            error = handleDuplicateKeyError(err);
        }

        if (err.name === "ValidationError") {
            error = handleValidationError(err);
        }

        sendErrorProd(error, res);
    } else {
        sendErrorDev(err, res);
    }
};


module.exports = errorHandler;
