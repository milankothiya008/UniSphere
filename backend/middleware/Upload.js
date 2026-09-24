const multer = require("multer");
const { env } = require("../config/env");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.maxUploadBytes, files: 1 }
});

const singleImage = (field = "file") => (req, res, next) => {
    upload.single(field)(req, res, (error) => {
        if (!error) {
            return next();
        }

        if (error.code === "LIMIT_FILE_SIZE") {
            const mb = Math.round(env.maxUploadBytes / (1024 * 1024));
            return next(new AppError(`Image must be ${mb} MB or smaller`, 413, ERROR_CODES.UPLOAD_ERROR));
        }

        return next(new AppError("Invalid upload", 400, ERROR_CODES.UPLOAD_ERROR));
    });
};

module.exports = { singleImage };
