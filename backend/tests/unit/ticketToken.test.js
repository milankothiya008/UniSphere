const { generateTicketCode, normalizeTicketCode, createTicketToken, readTicketToken, CODE_PATTERN } = require("../../utils/TicketToken");

describe("ticket codes and tokens", () => {
    test("codes are short, readable and avoid look-alike characters", () => {
        for (let i = 0; i < 200; i += 1) {
            const code = generateTicketCode();
            expect(code).toMatch(CODE_PATTERN);
            expect(code).not.toMatch(/[01OILU]/);
        }
        expect(new Set(Array.from({ length: 500 }, generateTicketCode)).size).toBe(500);
    });

    test("typed codes are normalised however students write them", () => {
        expect(normalizeTicketCode("cc-7k3m 9qwa")).toBe("CC-7K3M9QWA");
        expect(normalizeTicketCode("CC7K3M9QWA")).toBe("CC-7K3M9QWA");
        expect(normalizeTicketCode(" 7k3m9qwa ")).toBe("CC-7K3M9QWA");
        // A code body that itself starts with CC keeps it.
        expect(normalizeTicketCode("CCAB2345")).toBe("CC-CCAB2345");
        expect(normalizeTicketCode("7K3M9QW")).toBeNull();
        expect(normalizeTicketCode("CC-7K3M9QW0")).toBeNull();
        expect(normalizeTicketCode("")).toBeNull();
        expect(normalizeTicketCode(null)).toBeNull();
    });

    test("tokens round-trip and carry a signature over the registration and its code", () => {
        const registrationId = "64b000000000000000000001";
        const ticketCode = generateTicketCode();
        const token = createTicketToken({ registrationId, ticketCode });

        expect(token).toMatch(/^[a-f0-9]{24}\.CC-[A-Z2-9]{8}\.[A-Za-z0-9_-]{32}$/);
        expect(readTicketToken(token)).toEqual({ registrationId, ticketCode });
    });

    test("tampered or malformed tokens are rejected", () => {
        const registrationId = "64b000000000000000000001";
        const ticketCode = generateTicketCode();
        const token = createTicketToken({ registrationId, ticketCode });
        const [id, code, signature] = token.split(".");

        expect(readTicketToken(`${id}.${generateTicketCode()}.${signature}`)).toBeNull();
        expect(readTicketToken(`64b000000000000000000002.${code}.${signature}`)).toBeNull();
        const flipped = signature.slice(0, 31) + (signature.endsWith("A") ? "B" : "A");
        expect(readTicketToken(`${id}.${code}.${flipped}`)).toBeNull();
        expect(readTicketToken(`${id}.${code}`)).toBeNull();
        expect(readTicketToken("not-a-token")).toBeNull();
        expect(readTicketToken("")).toBeNull();
        expect(readTicketToken(undefined)).toBeNull();
    });
});
