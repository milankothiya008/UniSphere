// Indian mobile numbers, stored by the server as "+91" and ten digits starting 6-9.

/** The stored form of what someone typed ("98765 43210", "+91-98765-43210", "098765 43210"), or null. */
export const normalizePhone = (value) => {
    let digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
};

/** "+919876543210" → "+91 98765 43210". */
export const formatPhone = (phone) => {
    const match = /^\+91(\d{5})(\d{5})$/.exec(phone || "");
    return match ? `+91 ${match[1]} ${match[2]}` : phone || "";
};

/** What to show in an input for a stored number: the ten digits, spaced. */
export const phoneInputValue = (phone) => formatPhone(phone).replace(/^\+91 /, "");
