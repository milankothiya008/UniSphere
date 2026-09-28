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

// Story photos and videos (development storage only; production uploads go straight to Cloudinary).
const storyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.max(env.stories.maxImageBytes, env.stories.maxVideoBytes), files: 1 }
});

const singleStoryFile = (field = "file") => (req, res, next) => {
    storyUpload.single(field)(req, res, (error) => {
        if (!error) {
            return next();
        }
        if (error.code === "LIMIT_FILE_SIZE") {
            const mb = Math.round(env.stories.maxVideoBytes / (1024 * 1024));
            return next(new AppError(`Story files must be ${mb} MB or smaller`, 413, ERROR_CODES.UPLOAD_ERROR));
        }
        return next(new AppError("Invalid upload", 400, ERROR_CODES.UPLOAD_ERROR));
    });
};

// Event gallery photos and videos (development storage only, like stories).
const galleryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.max(env.gallery.maxImageBytes, env.gallery.maxVideoBytes), files: 1 }
});

const singleGalleryFile = (field = "file") => (req, res, next) => {
    galleryUpload.single(field)(req, res, (error) => {
        if (!error) {
            return next();
        }
        if (error.code === "LIMIT_FILE_SIZE") {
            const mb = Math.round(env.gallery.maxVideoBytes / (1024 * 1024));
            return next(new AppError(`Gallery files must be ${mb} MB or smaller`, 413, ERROR_CODES.UPLOAD_ERROR));
        }
        return next(new AppError("Invalid upload", 400, ERROR_CODES.UPLOAD_ERROR));
    });
};

// Recruitment application files (development storage only).
const recruitmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.recruitment.maxDocumentBytes, files: 1 }
});

const singleRecruitmentFile = (field = "file") => (req, res, next) => {
    recruitmentUpload.single(field)(req, res, (error) => {
        if (!error) {
            return next();
        }
        if (error.code === "LIMIT_FILE_SIZE") {
            const mb = Math.round(env.recruitment.maxDocumentBytes / (1024 * 1024));
            return next(new AppError(`Files must be ${mb} MB or smaller`, 413, ERROR_CODES.UPLOAD_ERROR));
        }
        return next(new AppError("Invalid upload", 400, ERROR_CODES.UPLOAD_ERROR));
    });
};

module.exports = { singleImage, singleStoryFile, singleGalleryFile, singleRecruitmentFile };
