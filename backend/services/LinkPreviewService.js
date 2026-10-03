const dns = require("dns").promises;
const net = require("net");
const { TtlCache } = require("../utils/TtlCache");

// Preview cards for links in chat (title, description, image), read from the page's Open Graph tags.
//
// The server fetches pages on behalf of users, so it only ever talks to public internet addresses: every
// hostname (and every redirect) is resolved first and refused if it points at a private, loopback, link-local
// or otherwise reserved address. Responses are capped in time and size, and only HTML is read.

const TIMEOUT_MS = 4000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const cache = new TtlCache(6 * 60 * 60 * 1000, 500);

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/i;

/** The first http(s) link in a text, without trailing punctuation. */
const firstLink = (text) => {
    const match = URL_PATTERN.exec(String(text || ""));
    return match ? match[0].replace(/[),.!?;:]+$/, "") : null;
};

const privateV4 = (ip) => {
    const [a, b] = ip.split(".").map(Number);
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
};

const privateV6 = (ip) => {
    const value = ip.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("::ffff:")) return privateV4(value.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value);
};

const isPublicAddress = (ip) => (net.isIPv4(ip) ? !privateV4(ip) : net.isIPv6(ip) ? !privateV6(ip) : false);

/** Throws unless the URL is http(s) on a standard port and every address it resolves to is public. */
const assertPublicUrl = async (raw) => {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only web links");
    if (url.username || url.password) throw new Error("No credentials in links");
    if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard ports");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    if (!addresses.length || !addresses.every(isPublicAddress)) throw new Error("Address not allowed");
    return url;
};

const decode = (value) =>
    String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/\s+/g, " ")
        .trim();

const metaContent = (html, names) => {
    for (const name of names) {
        const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
        const tag = pattern.exec(html)?.[0];
        const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
        if (content) return decode(content);
    }
    return "";
};

const parse = (html, pageUrl) => {
    const title = metaContent(html, ["og:title", "twitter:title"]) || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]);
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    let image = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
    if (image) {
        try {
            image = new URL(image, pageUrl).toString();
            if (!image.startsWith("https://")) image = "";
        } catch {
            image = "";
        }
    }
    const site = metaContent(html, ["og:site_name"]) || new URL(pageUrl).hostname.replace(/^www\./, "");
    return title ? { url: pageUrl, title: title.slice(0, 200), description: description.slice(0, 300), image: image.slice(0, 1000), site: site.slice(0, 80) } : null;
};

const readLimited = async (response) => {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
};

const fetchPreview = async (raw) => {
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const url = await assertPublicUrl(current);
        const response = await fetch(url, {
            redirect: "manual",
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { "user-agent": "CampusConnectBot/1.0 (+link preview)", accept: "text/html" }
        });
        if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
            current = new URL(response.headers.get("location"), url).toString();
            continue;
        }
        if (!response.ok || !String(response.headers.get("content-type") || "").includes("text/html")) return null;
        return parse(await readLimited(response), url.toString());
    }
    return null;
};

/** A preview for the link, or null (unreachable, not HTML, private address…). Never throws. */
const previewFor = async (raw) => {
    if (!raw) return null;
    const cached = cache.get(raw);
    if (cached !== undefined) return cached;
    let preview = null;
    try {
        preview = await fetchPreview(raw);
    } catch {
        preview = null;
    }
    cache.set(raw, preview);
    return preview;
};

module.exports = { firstLink, previewFor, isPublicAddress, assertPublicUrl, parse };
