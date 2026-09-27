const { env } = require("../../config/env");
const { parseAddress, deliverWithBrevo } = require("../../services/MailService");

describe("Brevo email delivery", () => {
    const realFetch = global.fetch;

    afterEach(() => {
        global.fetch = realFetch;
    });

    test("sender names and addresses are read from MAIL_FROM", () => {
        expect(parseAddress("CampusConnect <team@gmail.com>")).toEqual({ name: "CampusConnect", email: "team@gmail.com" });
        expect(parseAddress('"Campus Connect" <a@b.co>')).toEqual({ name: "Campus Connect", email: "a@b.co" });
        expect(parseAddress("plain@b.co")).toEqual({ email: "plain@b.co" });
    });

    test("messages go to Brevo's HTTPS API with the key, sender and unsubscribe headers", async () => {
        Object.assign(env, { brevoApiKey: "xkeysib-test", mailFrom: "CampusConnect <team@gmail.com>" });
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: "m1" }) });

        await deliverWithBrevo({ to: "24ceuog001@ddu.ac.in", subject: "123456 is your code", html: "<p>hi</p>", text: "hi", headers: { "List-Unsubscribe": "<https://x/u>" } });

        const [url, request] = global.fetch.mock.calls[0];
        expect(url).toBe("https://api.brevo.com/v3/smtp/email");
        expect(request.headers["api-key"]).toBe("xkeysib-test");
        expect(JSON.parse(request.body)).toEqual({
            sender: { name: "CampusConnect", email: "team@gmail.com" },
            to: [{ email: "24ceuog001@ddu.ac.in" }],
            subject: "123456 is your code",
            htmlContent: "<p>hi</p>",
            textContent: "hi",
            headers: { "List-Unsubscribe": "<https://x/u>" }
        });
    });

    test("a refused message throws, so the email queue retries it", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: "invalid_parameter", message: "sender not valid" }) });
        await expect(deliverWithBrevo({ to: "a@b.co", subject: "s", html: "h", text: "t" })).rejects.toThrow("Brevo refused the email (400 invalid_parameter sender not valid)");
    });
});
