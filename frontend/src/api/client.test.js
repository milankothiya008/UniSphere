import { api, ApiError, setAccessToken, setSessionExpiredHandler } from "./client";

const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body))
});

describe("api client", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        setAccessToken(null);
    });

    test("sends the bearer token and returns the parsed body", async () => {
        setAccessToken("token-1");
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { data: { ok: true } }));

        const response = await api.get("/clubs", { page: 2, search: "" });

        expect(response.data.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/clubs?page=2");
        expect(init.headers.Authorization).toBe("Bearer token-1");
    });

    test("surfaces API errors with status, code and details", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            json(409, { message: "Seminar Hall A is already booked", errorCode: "VENUE_CONFLICT", details: { conflicts: [] } })
        );

        await expect(api.post("/events", {})).rejects.toMatchObject({
            name: "ApiError",
            status: 409,
            code: "VENUE_CONFLICT",
            message: "Seminar Hall A is already booked"
        });
    });

    test("refreshes once for parallel 401s and retries each request", async () => {
        setAccessToken("expired");
        let refreshCalls = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
            if (url === "/api/auth/refresh") {
                refreshCalls += 1;
                return Promise.resolve(json(200, { data: { accessToken: "fresh", user: {} } }));
            }
            return Promise.resolve(init.headers.Authorization === "Bearer fresh" ? json(200, { data: url }) : json(401, { message: "Session expired" }));
        });

        const [a, b] = await Promise.all([api.get("/feed"), api.get("/dashboard")]);

        expect(refreshCalls).toBe(1);
        expect(a.data).toBe("/api/feed");
        expect(b.data).toBe("/api/dashboard");
    });

    test("identical GETs share one request for a few seconds, and any change clears the cache", async () => {
        setAccessToken("token-1");
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(json(200, { data: "ok" })));

        await Promise.all([api.get("/clubs", { page: 1 }), api.get("/clubs", { page: 1 })]);
        await api.get("/clubs", { page: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await api.post("/clubs/c1/subscription", {});
        await api.get("/clubs", { page: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // Another user never gets the previous user's cached response.
        setAccessToken("token-2");
        await api.get("/clubs", { page: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    test("signals session expiry when refresh fails", async () => {
        setAccessToken("expired");
        const expired = vi.fn();
        setSessionExpiredHandler(expired);
        vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
            Promise.resolve(url === "/api/auth/refresh" ? json(401, { message: "Refresh token has been revoked" }) : json(401, { message: "Session expired" }))
        );

        await expect(api.get("/feed")).rejects.toBeInstanceOf(ApiError);
        expect(expired).toHaveBeenCalledTimes(1);
    });
});
