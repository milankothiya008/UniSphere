class AppError extends Error {
    constructor(message, statusCode, errorCode = null) {
        super(message);

        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
        this.isOperational = true;
        this.errorCode = errorCode;

        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;
