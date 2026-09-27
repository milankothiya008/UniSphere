const nodemailer = require("nodemailer");
const { env } = require("../config/env");
const logger = require("../utils/Logger");

// Messages sent while NODE_ENV=test are kept here so tests can read codes
// without the API ever returning them.
const outbox = [];

// Without SMTP in development, messages are captured here and shown on the /dev/inbox page
// so verification and reset codes are reachable. Never used in production.
const DEV_INBOX_LIMIT = 100;
const devInbox = [];
let devInboxSequence = 0;

// "brevo" and "smtp" deliver real email; "preview" captures it in the development inbox; "disabled" drops it
// (production with no email provider).
const deliveryMode = () => {
    if (env.brevoApiKey) {
        return "brevo";
    }
    if (env.smtp.host) {
        return "smtp";
    }
    return env.isProduction ? "disabled" : "preview";
};

const extractLinks = (text) => String(text || "").match(/https?:\/\/[^\s"<>]+/g) || [];

const listDevInbox = ({ to } = {}) => {
    const address = to ? String(to).trim().toLowerCase() : null;
    return devInbox.filter((mail) => !address || mail.to === address);
};

let transporter = null;

const getTransporter = () => {
    if (!env.smtp.host) {
        return null;
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: env.smtp.host,
            port: env.smtp.port,
            secure: env.smtp.secure,
            auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined
        });
    }

    return transporter;
};

const escapeHtml = (value) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

// Links and images in emails must be absolute; uploads are stored as "/uploads/...".
const absoluteUrl = (value) => {
    if (!value) {
        return null;
    }
    return /^https?:\/\//i.test(value) ? value : `${env.clientUrl}${value.startsWith("/") ? "" : "/"}${value}`;
};

const muted = "font-size:12px;color:#64748b;line-height:1.5";

// details: [[label, value], ...]; reason: why this person got the email; footerLinks: [{ label, url }] (e.g. unsubscribe).
const layout = ({ heading, paragraphs = [], action = null, code = null, footnote = null, image = null, details = [], reason = null, footerLinks = [] }) => {
    const hero = image
        ? `<img src="${escapeHtml(absoluteUrl(image))}" alt="" width="512" style="display:block;width:100%;max-width:512px;height:auto;border-radius:12px;margin:0 0 18px" />`
        : "";
    const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`).join("");
    const rows = details.filter(([, value]) => value);
    const table = rows.length
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 18px;border-collapse:collapse;background:#f8fafc;border-radius:10px">
            ${rows
                .map(
                    ([label, value]) =>
                        `<tr><td style="padding:9px 14px;font-size:13px;color:#64748b;width:110px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:9px 14px;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`
                )
                .join("")}
           </table>`
        : "";
    const codeBlock = code
        ? `<p style="margin:22px 0;font-size:32px;font-weight:700;letter-spacing:10px;font-family:Consolas,Menlo,monospace;color:#0f172a;background:#eff6ff;border-radius:10px;padding:14px 0;text-align:center">${escapeHtml(code)}</p>`
        : "";
    const note = footnote ? `<p style="font-size:13px;color:#64748b;line-height:1.5">${escapeHtml(footnote)}</p>` : "";
    const button = action
        ? `<p style="margin:22px 0"><a href="${escapeHtml(absoluteUrl(action.url))}" style="background:#1d4ed8;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
           <p style="${muted}">If the button does not work, open this link: ${escapeHtml(absoluteUrl(action.url))}</p>`
        : "";
    const why = reason ? `<p style="${muted};margin:24px 0 4px">${escapeHtml(reason)}</p>` : "";
    const links = footerLinks.length
        ? `<p style="${muted};margin:4px 0 0">${footerLinks
              .map((link) => `<a href="${escapeHtml(absoluteUrl(link.url))}" style="color:#64748b;text-decoration:underline">${escapeHtml(link.label)}</a>`)
              .join(" &nbsp;·&nbsp; ")}</p>`
        : "";

    return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <div style="font-weight:700;font-size:18px;color:#1d4ed8;margin-bottom:18px">CampusConnect</div>
        ${hero}<h2 style="margin:0 0 14px;font-size:20px">${escapeHtml(heading)}</h2>
        ${body}${table}${codeBlock}${button}${note}${why}${links}
        <p style="${muted};margin-top:${why || links ? "10px" : "28px"}">${escapeHtml(env.universityName)} · CampusConnect</p>
    </div>`;
};

// "CampusConnect <team@example.com>" -> { name, email }
const parseAddress = (value) => {
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(value || ""));
    return match ? { name: match[1].trim() || undefined, email: match[2].trim() } : { email: String(value || "").trim() };
};

// Sends through Brevo's HTTPS API (port 443), which works where outgoing SMTP ports are blocked.
const deliverWithBrevo = async ({ to, subject, html, text, headers }) => {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.brevoApiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
            sender: parseAddress(env.mailFrom),
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text,
            ...(headers ? { headers } : {})
        })
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`Brevo refused the email (${response.status} ${body.code || ""} ${body.message || ""})`.trim());
    }
};

// Delivers one message and throws when the provider refuses it, so the queue can retry.
// `code` is only used to show one-time codes in the test outbox and the development inbox.
const deliver = async ({ to, subject, html, text, code = null, headers = undefined }) => {
    if (env.isTest) {
        outbox.push({ to, subject, html, text, code, headers });
        return;
    }

    if (env.brevoApiKey) {
        await deliverWithBrevo({ to, subject, html, text, headers });
        return;
    }

    const transport = getTransporter();

    if (!transport) {
        if (env.isProduction) {
            logger.warn("SMTP is not configured; email not sent", { to, subject });
            return;
        }

        devInbox.unshift({
            id: String(++devInboxSequence),
            to: String(to).toLowerCase(),
            subject,
            text,
            html,
            code,
            links: extractLinks(text),
            sentAt: new Date().toISOString()
        });
        devInbox.splice(DEV_INBOX_LIMIT);
        logger.info("Email captured in the development inbox (SMTP not configured)", { to, subject });
        return;
    }

    await transport.sendMail({ from: env.mailFrom, to, subject, html, text, headers });
};

// For time-critical mail sent directly (verification and reset codes): logs instead of throwing.
const sendMail = async (message) => {
    try {
        await deliver(message);
    } catch (error) {
        logger.error("Email delivery failed", { to: message.to, subject: message.subject, message: error.message });
    }
};

const sendVerificationCode = async (user, code, ttlMinutes) => {
    await sendMail({
        to: user.email,
        code,
        subject: `${code} is your CampusConnect verification code`,
        text: `Hi ${user.name}, your CampusConnect verification code is ${code}. It expires in ${ttlMinutes} minutes. Never share this code with anyone.`,
        html: layout({
            heading: `Welcome, ${user.name}`,
            paragraphs: ["Enter this code on the verification screen to confirm your university email and activate your account."],
            code,
            footnote: `The code expires in ${ttlMinutes} minutes. CampusConnect staff will never ask for it. If you did not create an account, you can ignore this email.`
        })
    });
};

const sendPasswordResetCode = async (user, code, ttlMinutes) => {
    await sendMail({
        to: user.email,
        code,
        subject: `${code} is your CampusConnect password reset code`,
        text: `Hi ${user.name}, your CampusConnect password reset code is ${code}. It expires in ${ttlMinutes} minutes. If you did not request a reset, ignore this email.`,
        html: layout({
            heading: "Password reset requested",
            paragraphs: ["Enter this code on the reset screen to choose a new password."],
            code,
            footnote: `The code expires in ${ttlMinutes} minutes. If you did not request a password reset, you can ignore this email — your password stays the same.`
        })
    });
};

// Called at startup so a missing or broken email setup is obvious instead of failing silently.
const checkMailConfiguration = async () => {
    const mode = deliveryMode();

    if (mode === "preview") {
        logger.warn(`SMTP is not configured: emails are not sent. Open ${env.clientUrl}/dev/inbox to read them (development only).`);
        return mode;
    }

    if (mode === "disabled") {
        logger.warn("No email provider is configured (BREVO_API_KEY or SMTP_*): verification and reset emails cannot be delivered.");
        return mode;
    }

    if (mode === "brevo") {
        logger.info("Emails are delivered through the Brevo API", { from: parseAddress(env.mailFrom).email });
        return mode;
    }

    try {
        await getTransporter().verify();
        logger.info("SMTP connection verified; emails will be delivered", { host: env.smtp.host });
    } catch (error) {
        logger.error("SMTP connection failed; check SMTP_* settings in .env", { host: env.smtp.host, message: error.message });
    }
    return mode;
};

module.exports = {
    sendMail,
    deliver,
    layout,
    absoluteUrl,
    escapeHtml,
    sendVerificationCode,
    sendPasswordResetCode,
    deliveryMode,
    listDevInbox,
    checkMailConfiguration,
    parseAddress,
    deliverWithBrevo,
    outbox
};
