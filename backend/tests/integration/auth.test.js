const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, api, lastMailTo, codeFromMail, outbox } = require("../helpers/factory");
const RefreshToken = require("../../models/RefreshToken");
const User = require("../../models/User");

const agentCookie = (res) => res.headers["set-cookie"].find((c) => c.startsWith("refreshToken=")).split(";")[0];

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
    await db.clear();
    outbox.length = 0;
    await seedReferenceData();
});

// Registrations default to the student role unless a test chooses otherwise.
const register = (body) => request(app).post("/api/auth/register").send({ accountType: "STUDENT", ...body });

describe("registration", () => {
    test("derives a student account from the university email and emails a code it never returns", async () => {
        const res = await register({ name: "Asha Patel", email: "24CEUOG001@ddu.ac.in", password: "Secret123" });

        expect(res.status).toBe(201);
        expect(res.body.data.user).toMatchObject({
            accountType: "STUDENT",
            globalRole: "STUDENT",
            departmentCode: "CE",
            batchCode: "24",
            isEmailVerified: false
        });
        expect(res.body.data.otp).toEqual({ length: 6, expiresInMinutes: 10, resendAfterSeconds: 60 });

        const mail = lastMailTo("24ceuog001@ddu.ac.in");
        expect(codeFromMail(mail)).toMatch(/^\d{6}$/);
        expect(mail.text).toContain(codeFromMail(mail));
        expect(mail.text).not.toMatch(/https?:\/\//);
        expect(JSON.stringify(res.body)).not.toMatch(/CodeHash|Attempts|password/);
        expect(JSON.stringify(res.body)).not.toContain(codeFromMail(mail));
    });

    test("registers faculty with the first-name.department format", async () => {
        const res = await register({ name: "Mrudang Shah", email: "mrudang.ce@ddu.ac.in", password: "Secret123", accountType: "FACULTY", globalRole: "ADMIN" });

        expect(res.status).toBe(201);
        expect(res.body.data.user).toMatchObject({ accountType: "FACULTY", globalRole: "FACULTY", departmentCode: "CE", batchCode: null });
        expect(lastMailTo("mrudang.ce@ddu.ac.in")).toBeDefined();
    });

    test("requires a role choice", async () => {
        const res = await request(app).post("/api/auth/register").send({ name: "X Y", email: "24ceuog001@ddu.ac.in", password: "Secret123" });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/student or faculty/);
    });

    test("checks the email against the chosen role's format", async () => {
        const asFaculty = await register({ name: "X Y", email: "24ceuog001@ddu.ac.in", password: "Secret123", accountType: "FACULTY" });
        expect(asFaculty.body.errorCode).toBe("INVALID_EMAIL");
        expect(asFaculty.body.message).toMatch(/mrudang.ce@ddu.ac.in.*looks like a student email/);

        const asStudent = await register({ name: "X Y", email: "mrudang.ce@ddu.ac.in", password: "Secret123", accountType: "STUDENT" });
        expect(asStudent.body.errorCode).toBe("INVALID_EMAIL");
        expect(asStudent.body.message).toMatch(/24ceuog001@ddu.ac.in.*looks like a faculty email/);

        const badFaculty = await register({ name: "X Y", email: "mrudang.shah.ce@ddu.ac.in", password: "Secret123", accountType: "FACULTY" });
        expect(badFaculty.body.message).toMatch(/Faculty emails must be/);
    });

    test("rejects non-university emails, unknown batches and weak passwords", async () => {
        expect((await register({ name: "X Y", email: "someone@gmail.com", password: "Secret123" })).body.errorCode).toBe("INVALID_EMAIL");
        expect((await register({ name: "X Y", email: "19CEUOG001@ddu.ac.in", password: "Secret123" })).body.errorCode).toBe("INVALID_EMAIL");
        expect((await register({ name: "X Y", email: "24CEUOG001@ddu.ac.in", password: "password" })).status).toBe(400);
    });

    test("rejects emails that do not follow the university formats", async () => {
        for (const email of ["24CE1234@ddu.ac.in", "24ceuog01@ddu.ac.in", "brij.patel.ce@ddu.ac.in", "brij1.ce@ddu.ac.in"]) {
            const res = await register({ name: "X Y", email, password: "Secret123" });
            expect(res.body.errorCode).toBe("INVALID_EMAIL");
            expect(res.body.message).toMatch(/24ceuog001@ddu\.ac\.in/);
        }
    });

    test("rejects unknown departments in either format", async () => {
        expect((await register({ name: "X Y", email: "24zzuog001@ddu.ac.in", password: "Secret123" })).body.message).toMatch(/Department 'ZZ'/);
        expect((await register({ name: "X Y", email: "brij.zz@ddu.ac.in", password: "Secret123", accountType: "FACULTY" })).body.message).toMatch(/Department 'ZZ'/);
    });

    test("rejects duplicate accounts, pointing unverified ones to the code screen", async () => {
        await register({ name: "Asha Patel", email: "24CEUOG001@ddu.ac.in", password: "Secret123" });
        const pending = await register({ name: "Asha Patel", email: "24ceuog001@ddu.ac.in", password: "Secret123" });
        expect(pending.status).toBe(409);
        expect(pending.body.errorCode).toBe("UNVERIFIED_EMAIL");

        await User.updateOne({ email: "24ceuog001@ddu.ac.in" }, { isEmailVerified: true });
        const taken = await register({ name: "Asha Patel", email: "24ceuog001@ddu.ac.in", password: "Secret123" });
        expect(taken.status).toBe(409);
        expect(taken.body.errorCode).toBe("CONFLICT");
    });
});

describe("verification, login, refresh and logout", () => {
    const email = "24ceuog201@ddu.ac.in";

    const verify = (code, address = email) => request(app).post("/api/auth/verify-email").send({ email: address, code });

    const registerAndVerify = async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        return verify(codeFromMail(lastMailTo(email)));
    };

    const wrongCode = (code) => String((Number(code) + 1) % 1000000).padStart(6, "0");

    test("blocks login until the email is verified", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        const res = await request(app).post("/api/auth/login").send({ email, password: "Secret123" });
        expect(res.status).toBe(403);
        expect(res.body.errorCode).toBe("UNVERIFIED_EMAIL");
    });

    test("verifies the email, logs in and fetches the profile", async () => {
        const verified = await registerAndVerify();
        expect(verified.status).toBe(200);
        expect(verified.body.data.isEmailVerified).toBe(true);

        const login = await request(app).post("/api/auth/login").send({ email, password: "Secret123" });
        expect(login.status).toBe(200);
        expect(login.body.data.accessToken).toBeDefined();
        expect(login.headers["set-cookie"].join(";")).toMatch(/refreshToken=.*HttpOnly/i);

        const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.data.accessToken}`);
        expect(me.body.data.email).toBe(email);
    });

    test("a code is single-use and belongs to its own email", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        await register({ name: "Other Student", email: "24ceuog202@ddu.ac.in", password: "Secret123" });
        const code = codeFromMail(lastMailTo(email));

        const otherAccount = await verify(code, "24ceuog202@ddu.ac.in");
        expect(otherAccount.status).toBe(400);

        expect((await verify(code)).status).toBe(200);
        const reused = await verify(code);
        expect(reused.status).toBe(400);
        expect(reused.body.errorCode).toBe("OTP_EXPIRED");
    });

    test("rejects malformed codes before checking them", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        for (const code of ["12345", "1234567", "abcdef", ""]) {
            const res = await verify(code);
            expect(res.status).toBe(400);
            expect(res.body.errorCode).toBe("VALIDATION_ERROR");
        }
        const user = await User.findOne({ email }).select("+emailVerificationAttempts");
        expect(user.emailVerificationAttempts).toBe(0);
    });

    test("counts wrong guesses and kills the code after five", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        const code = codeFromMail(lastMailTo(email));

        const first = await verify(wrongCode(code));
        expect(first.body.errorCode).toBe("OTP_INVALID");
        expect(first.body.message).toBe("Incorrect code. 4 attempts left.");
        expect(first.body.details).toEqual({ attemptsLeft: 4 });

        for (let i = 0; i < 3; i += 1) {
            await verify(wrongCode(code));
        }
        const fifth = await verify(wrongCode(code));
        expect(fifth.body.errorCode).toBe("OTP_EXPIRED");
        expect(fifth.body.message).toMatch(/Too many incorrect attempts/);

        // Even the right code no longer works once the limit is reached.
        expect((await verify(code)).body.errorCode).toBe("OTP_EXPIRED");
    });

    test("parallel guesses cannot exceed the attempt limit", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        const code = codeFromMail(lastMailTo(email));

        const results = await Promise.all(Array.from({ length: 12 }, () => verify(wrongCode(code))));
        expect(results.filter((res) => res.body.errorCode === "OTP_INVALID")).toHaveLength(4);
        expect((await verify(code)).body.errorCode).toBe("OTP_EXPIRED");
    });

    test("rejects an expired code", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        const code = codeFromMail(lastMailTo(email));
        await User.updateOne({ email }, { emailVerificationCodeExpires: new Date(Date.now() - 1000) });

        const res = await verify(code);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("OTP_EXPIRED");
    });

    test("resending waits for the cooldown, then replaces the old code", async () => {
        await register({ name: "Ravi Shah", email, password: "Secret123" });
        const firstCode = codeFromMail(lastMailTo(email));
        const sentBefore = outbox.length;

        const tooSoon = await request(app).post("/api/auth/resend-verification").send({ email });
        expect(tooSoon.status).toBe(200);
        expect(tooSoon.body.data.otp.resendAfterSeconds).toBe(60);
        expect(outbox.length).toBe(sentBefore);

        await User.updateOne({ email }, { emailVerificationSentAt: new Date(Date.now() - 61_000) });
        await request(app).post("/api/auth/resend-verification").send({ email });
        expect(outbox.length).toBe(sentBefore + 1);
        const secondCode = codeFromMail(lastMailTo(email));

        if (secondCode !== firstCode) {
            expect((await verify(firstCode)).status).toBe(400);
        }
        expect((await verify(secondCode)).status).toBe(200);
    });

    test("resend answers the same for unknown and verified accounts without sending mail", async () => {
        await registerAndVerify();
        const sentBefore = outbox.length;

        const verified = await request(app).post("/api/auth/resend-verification").send({ email });
        const unknown = await request(app).post("/api/auth/resend-verification").send({ email: "24ceuog999@ddu.ac.in" });
        expect(verified.body).toEqual(unknown.body);
        expect(outbox.length).toBe(sentBefore);
    });

    test("login only accepts emails in the university formats", async () => {
        for (const bad of ["someone@gmail.com", "24ce1234@ddu.ac.in", "brij.patel.ce@ddu.ac.in"]) {
            const res = await request(app).post("/api/auth/login").send({ email: bad, password: "Secret123" });
            expect(res.status).toBe(400);
            expect(res.body.errorCode).toBe("INVALID_EMAIL");
        }
    });

    test("the university admin signs in as admin@ddu.ac.in, which nobody can register", async () => {
        const { hashPassword } = require("../../utils/Password");
        await User.create({
            name: "University Admin",
            email: "admin@ddu.ac.in",
            password: await hashPassword("AdminPass123"),
            accountType: "FACULTY",
            globalRole: "ADMIN",
            isEmailVerified: true
        });

        const res = await request(app).post("/api/auth/login").send({ email: "Admin@DDU.ac.in", password: "AdminPass123" });
        expect(res.status).toBe(200);
        expect(res.body.data.user).toMatchObject({ email: "admin@ddu.ac.in", globalRole: "ADMIN" });

        // Only this one address is exempt from the formats, and only for signing in.
        for (const accountType of ["STUDENT", "FACULTY"]) {
            const signup = await register({ accountType, name: "Imposter", email: "admin@ddu.ac.in", password: "Secret123", confirmPassword: "Secret123" });
            expect(signup.status).toBe(400);
        }
        const other = await request(app).post("/api/auth/login").send({ email: "administrator@ddu.ac.in", password: "AdminPass123" });
        expect(other.body.errorCode).toBe("INVALID_EMAIL");
    });

    test("rejects a wrong password with a generic message", async () => {
        await registerAndVerify();
        const res = await request(app).post("/api/auth/login").send({ email, password: "Wrong1234" });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Invalid email or password");
    });

    test("rotates refresh tokens and revokes the family when an old token is replayed", async () => {
        await registerAndVerify();
        const login = await request(app).post("/api/auth/login").send({ email, password: "Secret123" });
        const firstCookie = agentCookie(login);

        const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", firstCookie);
        expect(refreshed.status).toBe(200);
        const secondCookie = agentCookie(refreshed);
        expect(secondCookie).not.toBe(firstCookie);

        // Simulate a replay long after rotation (outside the concurrency grace window).
        await RefreshToken.updateMany({ revokedAt: { $ne: null } }, { revokedAt: new Date(Date.now() - 60_000) });

        const replay = await request(app).post("/api/auth/refresh").set("Cookie", firstCookie);
        expect(replay.status).toBe(401);

        const afterTheft = await request(app).post("/api/auth/refresh").set("Cookie", secondCookie);
        expect(afterTheft.status).toBe(401);
    });

    test("logout revokes the refresh token", async () => {
        await registerAndVerify();
        const login = await request(app).post("/api/auth/login").send({ email, password: "Secret123" });
        const cookie = agentCookie(login);

        expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(200);
        expect((await request(app).post("/api/auth/refresh").set("Cookie", cookie)).status).toBe(401);
    });
});

describe("password reset", () => {
    const email = "24ceuog301@ddu.ac.in";

    const requestReset = (address = email) => request(app).post("/api/auth/forgot-password").send({ email: address });
    const confirmCode = (code, address = email) => request(app).post("/api/auth/verify-reset-code").send({ email: address, code });

    beforeEach(async () => {
        await register({ name: "Neha Joshi", email, password: "Secret123" });
    });

    test("resets the password with the emailed code and invalidates sessions", async () => {
        const generic = await requestReset("24ceuog999@ddu.ac.in");
        const real = await requestReset();
        expect(generic.status).toBe(200);
        expect(generic.body).toEqual(real.body);

        const mail = lastMailTo(email);
        expect(mail.subject).toMatch(/password reset code/);
        expect(mail.text).not.toMatch(/https?:\/\//);
        const code = codeFromMail(mail);

        const confirmed = await confirmCode(code);
        expect(confirmed.status).toBe(200);
        const { resetToken } = confirmed.body.data;
        expect(resetToken).toMatch(/^[a-f0-9]{64}$/);

        // The code is spent once it has been exchanged.
        expect((await confirmCode(code)).body.errorCode).toBe("OTP_EXPIRED");

        const reset = await request(app).post("/api/auth/reset-password").send({ token: resetToken, password: "NewSecret456" });
        expect(reset.status).toBe(200);
        expect((await request(app).post("/api/auth/reset-password").send({ token: resetToken, password: "Another789" })).status).toBe(400);

        // Entering the code also proves the email, so an unverified account can now sign in.
        const login = await request(app).post("/api/auth/login").send({ email, password: "NewSecret456" });
        expect(login.status).toBe(200);
    });

    test("a wrong reset code is counted and never yields a reset token", async () => {
        await requestReset();
        const code = codeFromMail(lastMailTo(email));
        const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");

        const res = await confirmCode(wrong);
        expect(res.body.errorCode).toBe("OTP_INVALID");
        expect(res.body.data).toBeUndefined();

        for (let i = 0; i < 4; i += 1) {
            await confirmCode(wrong);
        }
        expect((await confirmCode(code)).body.errorCode).toBe("OTP_EXPIRED");
    });

    test("a verification code cannot be used as a reset code", async () => {
        const verificationCode = codeFromMail(lastMailTo(email));
        const res = await confirmCode(verificationCode);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("OTP_EXPIRED");
    });

    test("the reset session expires", async () => {
        await requestReset();
        const { resetToken } = (await confirmCode(codeFromMail(lastMailTo(email)))).body.data;
        await User.updateOne({ email }, { passwordResetExpires: new Date(Date.now() - 1000) });

        const res = await request(app).post("/api/auth/reset-password").send({ token: resetToken, password: "NewSecret456" });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("TOKEN_INVALID");
    });

    test("does not issue a reset code to a disabled account", async () => {
        await User.updateOne({ email }, { isActive: false });
        const sentBefore = outbox.length;
        await requestReset();
        expect(outbox.length).toBe(sentBefore);
    });
});

describe("email delivery without SMTP", () => {
    test("reports preview mode and exposes the development inbox outside production", async () => {
        const health = await request(app).get("/api/health");
        expect(health.body.data.emailDelivery).toBe("preview");

        const inbox = await request(app).get("/api/dev/emails").query({ to: "24ceuog001@ddu.ac.in" });
        expect(inbox.status).toBe(200);
        expect(Array.isArray(inbox.body.data)).toBe(true);
    });

    test("captures messages with their code in the development inbox", async () => {
        const { env } = require("../../config/env");
        const mail = require("../../services/MailService");
        env.isTest = false;
        try {
            await mail.sendVerificationCode({ name: "Asha", email: "24ceuog001@ddu.ac.in" }, "482913", 10);
        } finally {
            env.isTest = true;
        }

        const [captured] = mail.listDevInbox({ to: "24CEUOG001@ddu.ac.in" });
        expect(captured.subject).toBe("482913 is your CampusConnect verification code");
        expect(captured.code).toBe("482913");
        expect(captured.links).toEqual([]);

        const inbox = await request(app).get("/api/dev/emails").query({ to: "24ceuog001@ddu.ac.in" });
        expect(inbox.body.data[0].code).toBe("482913");
    });
});

describe("protected routes", () => {
    test("reject missing and forged tokens", async () => {
        expect((await api(null).get("/api/dashboard")).status).toBe(401);
        const forged = await request(app).get("/api/dashboard").set("Authorization", "Bearer not-a-real-token");
        expect(forged.status).toBe(401);
    });
});
