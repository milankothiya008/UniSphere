const { hashPassword, comparePassword } = require("../../utils/Password");
const {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    hashToken,
    generateRawToken,
    refreshTokenTtlMs
} = require("../../utils/Token");

describe("Password Utilities", () => {
    test("hashes password and verifies correctly", async () => {
        const plain = "SuperSecret123!";
        const hashed = await hashPassword(plain);

        expect(hashed).not.toBe(plain);
        const matches = await comparePassword(plain, hashed);
        expect(matches).toBe(true);

        const wrongMatch = await comparePassword("WrongPassword", hashed);
        expect(wrongMatch).toBe(false);
    });
});

describe("Token Utilities", () => {
    test("signs and verifies access tokens", () => {
        const payload = { sub: "user123", role: "STUDENT" };
        const token = signAccessToken(payload);
        expect(token).toBeDefined();

        const decoded = verifyAccessToken(token);
        expect(decoded.sub).toBe("user123");
        expect(decoded.role).toBe("STUDENT");
    });

    test("signs and verifies refresh tokens", () => {
        const payload = { sub: "user123" };
        const token = signRefreshToken(payload);
        expect(token).toBeDefined();

        const decoded = verifyRefreshToken(token);
        expect(decoded.sub).toBe("user123");
    });

    test("hashes raw tokens consistently", () => {
        const raw = generateRawToken();
        expect(raw).toHaveLength(64);

        const hash1 = hashToken(raw);
        const hash2 = hashToken(raw);
        expect(hash1).toBe(hash2);
    });

    test("parses refresh token TTL correctly", () => {
        const ttl = refreshTokenTtlMs();
        expect(typeof ttl).toBe("number");
        expect(ttl).toBeGreaterThan(0);
    });
});
