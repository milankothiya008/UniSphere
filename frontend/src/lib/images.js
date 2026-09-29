// Cloudinary serves any size and format of an uploaded image from its URL. Asking for the size a spot
// actually shows (and letting it pick WebP/AVIF and the quality) turns 300 KB posters into ~30 KB cards.
const UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+)$/;

/**
 * The URL of `src` at most `width` CSS pixels wide (doubled for sharp screens), in the best format the
 * browser takes. URLs that aren't plain Cloudinary uploads (already transformed, local, other hosts) are
 * returned unchanged.
 */
export const imageUrl = (src, width, { blur = false } = {}) => {
    if (!src || typeof src !== "string") return src;
    const match = UPLOAD.exec(src);
    if (!match) return src;
    const pixels = Math.min(2400, Math.round(width * (blur ? 1 : 2)));
    const transform = ["f_auto", "q_auto", "c_limit", `w_${pixels}`, blur ? "e_blur:800" : null].filter(Boolean).join(",");
    return `${match[1]}${transform}/${match[2]}`;
};

/** For CSS backgrounds (`--cover: url(...)`). */
export const cssImage = (src, width) => (src ? `url("${String(imageUrl(src, width)).replace(/"/g, "%22")}")` : undefined);
