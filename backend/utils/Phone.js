// Indian mobile numbers, stored as "+91" and ten digits starting 6-9 (e.g. "+919876543210").
const MOBILE = /^[6-9]\d{9}$/;

/**
 * Accepts the usual ways people type a number ("98765 43210", "+91-98765-43210", "098765 43210")
 * and returns the stored form, or null when it isn't a valid Indian mobile number.
 */
const normalizePhone = (value) => {
    let digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    return MOBILE.test(digits) ? `+91${digits}` : null;
};

module.exports = { normalizePhone };
