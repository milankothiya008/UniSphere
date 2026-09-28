const { layout, absoluteUrl } = require("./MailService");
const { createUnsubscribeToken } = require("../utils/UnsubscribeToken");
const { EMAIL_CATEGORIES, EMAIL_PREFERENCES } = require("../constants/EmailCategories");

const SETTINGS_PATH = "/settings/notifications";

const preferenceLabel = (category) => EMAIL_PREFERENCES.find((preference) => preference.key === category)?.label || category;

// Builds one person's copy of an email. Optional categories get unsubscribe links in the footer plus
// List-Unsubscribe headers, so Gmail/Outlook show their own "Unsubscribe" button (one click, RFC 8058).
// `club` ({ _id, name }) makes the unsubscribe switch off that club's bell instead of the whole category.
const composeEmail = (user, { category, subject, heading, paragraphs = [], details = [], image = null, action = null, reason = null, club = null, code = null, qr = null }) => {
    const footerLinks = [];
    const headers = {};

    if (category !== EMAIL_CATEGORIES.ACCOUNT) {
        const categoryToken = createUnsubscribeToken({ userId: user._id, scope: "pref", key: category });
        const clubToken = club ? createUnsubscribeToken({ userId: user._id, scope: "club", key: club._id }) : null;

        if (clubToken) {
            footerLinks.push({ label: `Turn off emails from ${club.name}`, url: `/unsubscribe?token=${clubToken}` });
        } else {
            footerLinks.push({ label: `Unsubscribe from "${preferenceLabel(category)}"`, url: `/unsubscribe?token=${categoryToken}` });
        }
        footerLinks.push({ label: "Email settings", url: SETTINGS_PATH });

        headers["List-Unsubscribe"] = `<${absoluteUrl(`/api/notifications/unsubscribe?token=${clubToken || categoryToken}`)}>`;
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    const greeting = `Hi ${String(user.name || "there").split(" ")[0]},`;
    const text = [
        greeting,
        heading,
        ...paragraphs,
        ...details.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
        code ? `Ticket code: ${code}` : null,
        qr ? `QR code: ${absoluteUrl(qr.src)}` : null,
        action ? `${action.label}: ${absoluteUrl(action.url)}` : null,
        reason,
        ...footerLinks.map((link) => `${link.label}: ${absoluteUrl(link.url)}`)
    ]
        .filter(Boolean)
        .join("\n\n");

    return {
        to: user.email,
        user: user._id,
        category,
        subject,
        html: layout({ heading, paragraphs: [greeting, ...paragraphs], details, image, action, reason, footerLinks, code, qr }),
        text,
        headers: Object.keys(headers).length ? headers : undefined
    };
};

module.exports = { composeEmail, SETTINGS_PATH };
