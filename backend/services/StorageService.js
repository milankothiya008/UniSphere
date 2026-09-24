const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { env } = require("../config/env");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");

const IMAGE_SIGNATURES = [
    { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    {
        ext: "png",
        mime: "image/png",
        test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    },
    {
        ext: "webp",
        mime: "image/webp",
        test: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"
    }
];

const ALLOWED_FOLDERS = ["club-logos", "club-covers", "event-posters", "feed"];

// Detect the type from the file's bytes rather than trusting the client-supplied mimetype.
const detectImage = (buffer) => {
    if (!buffer || buffer.length < 12) {
        return null;
    }
    return IMAGE_SIGNATURES.find((sig) => sig.test(buffer)) || null;
};

const useCloudinary = () => Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

const uploadToCloudinary = async (buffer, image, folder) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const targetFolder = `${env.cloudinary.folder}/${folder}`;
    const signature = crypto
        .createHash("sha1")
        .update(`folder=${targetFolder}&timestamp=${timestamp}${env.cloudinary.apiSecret}`)
        .digest("hex");

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: image.mime }));
    form.append("api_key", env.cloudinary.apiKey);
    form.append("timestamp", String(timestamp));
    form.append("folder", targetFolder);
    form.append("signature", signature);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/image/upload`, {
        method: "POST",
        body: form
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.secure_url) {
        throw new AppError("Image upload failed", 502, ERROR_CODES.UPLOAD_ERROR);
    }

    return payload.secure_url;
};

const saveLocally = async (buffer, image, folder) => {
    const dir = path.join(env.uploadDir, folder);
    await fs.mkdir(dir, { recursive: true });

    const fileName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${image.ext}`;
    await fs.writeFile(path.join(dir, fileName), buffer);

    return `${env.publicApiUrl}/uploads/${folder}/${fileName}`;
};

const storeImage = async (file, folder) => {
    if (!file || !file.buffer) {
        throw new AppError("An image file is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (!ALLOWED_FOLDERS.includes(folder)) {
        throw new AppError("Invalid upload target", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const image = detectImage(file.buffer);

    if (!image) {
        throw new AppError("Only JPEG, PNG or WebP images are allowed", 400, ERROR_CODES.UPLOAD_ERROR);
    }

    const url = useCloudinary()
        ? await uploadToCloudinary(file.buffer, image, folder)
        : await saveLocally(file.buffer, image, folder);

    return { url, type: image.mime, size: file.buffer.length };
};

module.exports = { storeImage, detectImage, ALLOWED_FOLDERS };
