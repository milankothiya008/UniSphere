const BASE = import.meta.env.VITE_API_URL || "/api";
export const API_BASE = BASE;

export class ApiError extends Error {
    constructor(message, { status = 0, code = null, details = null } = {}) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

let accessToken = null;
let refreshPromise = null;
let onSessionExpired = () => {};

export const setAccessToken = (token) => {
    accessToken = token;
    // A different (or no) user never sees the previous user's cached responses.
    getCache.clear();
};

export const getAccessToken = () => accessToken;

export const setSessionExpiredHandler = (handler) => {
    onSessionExpired = handler;
};

const buildUrl = (path, query) => {
    const url = `${BASE}${path}`;
    if (!query) {
        return url;
    }

    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            params.append(key, value);
        }
    });

    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
};

const parse = async (response) => {
    const text = await response.text();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
};

// Every caller shares one in-flight refresh, so parallel 401s never rotate the token twice.
export const refreshSession = () => {
    if (!refreshPromise) {
        refreshPromise = fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
            .then(async (response) => {
                const body = await parse(response);
                if (!response.ok) {
                    throw new ApiError(body.message || "Session expired", { status: response.status, code: body.errorCode });
                }
                accessToken = body.data.accessToken;
                return body.data;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
};

export const request = async (path, { method = "GET", body, query, retry = true } = {}) => {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const headers = {};

    if (body !== undefined && !isForm) {
        headers["Content-Type"] = "application/json";
    }
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    let response;
    try {
        response = await fetch(buildUrl(path, query), {
            method,
            headers,
            credentials: "include",
            body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
        });
    } catch {
        throw new ApiError("Cannot reach CampusConnect. Check your connection and try again.");
    }

    if (response.status === 401 && retry && accessToken && !path.startsWith("/auth/")) {
        try {
            await refreshSession();
        } catch {
            accessToken = null;
            onSessionExpired();
            throw new ApiError("Your session has expired. Please sign in again.", { status: 401, code: "SESSION_EXPIRED" });
        }
        return request(path, { method, body, query, retry: false });
    }

    const payload = await parse(response);

    if (!response.ok) {
        throw new ApiError(payload.message || `Request failed (${response.status})`, {
            status: response.status,
            code: payload.errorCode || null,
            details: payload.details || null
        });
    }

    return payload;
};

// A short-lived cache for GET requests: going back to a page within a few seconds is instant, and
// identical requests made at the same time share one response. Any change (POST/PUT/PATCH/DELETE) clears
// it, so what you see after an action is always fresh.
const GET_TTL_MS = 8000;
const getCache = new Map();

export const clearRequestCache = () => getCache.clear();

const cachedGet = (path, query) => {
    const key = `${accessToken ? accessToken.slice(-16) : "anon"} ${buildUrl(path, query)}`;
    const hit = getCache.get(key);
    if (hit && Date.now() - hit.at < GET_TTL_MS) {
        return hit.promise;
    }
    const promise = request(path, { query });
    getCache.set(key, { at: Date.now(), promise });
    promise.catch(() => getCache.delete(key));
    if (getCache.size > 200) {
        getCache.delete(getCache.keys().next().value);
    }
    return promise;
};

const change = (method) => (path, body) => {
    getCache.clear();
    return request(path, { method, body }).finally(() => getCache.clear());
};

export const api = {
    get: cachedGet,
    post: change("POST"),
    put: change("PUT"),
    patch: change("PATCH"),
    delete: change("DELETE")
};
