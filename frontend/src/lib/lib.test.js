import { detectAccountType, emailProblemForRole, passwordProblems } from "./validation";
import { fromDateTimeInput, humanize, toDateInput, toDateTimeInput } from "./format";

describe("detectAccountType", () => {
    test("recognises student emails: batch, department, identity, number", () => {
        expect(detectAccountType("24CEUOG001@ddu.ac.in")).toEqual({ type: "STUDENT", batch: "2024", department: "CE", identity: "UOG001" });
        expect(detectAccountType("24cseabc123@ddu.ac.in").department).toBe("CSE");
    });

    test("recognises faculty emails: first name, dot, department", () => {
        expect(detectAccountType("brij.ce@ddu.ac.in")).toEqual({ type: "FACULTY", department: "CE" });
    });

    test.each(["someone@gmail.com", "24ce1234@ddu.ac.in", "24ceuog01@ddu.ac.in", "brij.patel.ce@ddu.ac.in", "brij1.ce@ddu.ac.in"])(
        "rejects %s",
        (email) => {
            expect(detectAccountType(email)).toBeNull();
        }
    );
});

describe("passwordProblems", () => {
    test("requires length, a letter and a number", () => {
        expect(passwordProblems("short")).toEqual(["at least 8 characters", "a number"]);
        expect(passwordProblems("12345678")).toEqual(["a letter"]);
        expect(passwordProblems("Secret123")).toEqual([]);
    });
});

describe("university-time conversions", () => {
    test("datetime-local values round-trip through UTC in the university timezone", () => {
        const iso = fromDateTimeInput("2026-10-05T09:30");
        expect(iso).toBe("2026-10-05T04:00:00.000Z");
        expect(toDateTimeInput(iso)).toBe("2026-10-05T09:30");
    });

    test("dates are taken in the university timezone, not the device's", () => {
        expect(toDateInput("2026-10-04T20:00:00.000Z")).toBe("2026-10-05");
    });

    test("humanize turns enum values into labels", () => {
        expect(humanize("EVENT_COORDINATOR")).toBe("Event Coordinator");
    });
});

describe("emailProblemForRole", () => {
    test("accepts emails that match the chosen role", () => {
        expect(emailProblemForRole("24ceuog001@ddu.ac.in", "STUDENT")).toBeNull();
        expect(emailProblemForRole("mrudang.ce@ddu.ac.in", "FACULTY")).toBeNull();
    });

    test("points out when the email belongs to the other role", () => {
        expect(emailProblemForRole("mrudang.ce@ddu.ac.in", "STUDENT")).toMatch(/looks like a faculty email/);
        expect(emailProblemForRole("24ceuog001@ddu.ac.in", "FACULTY")).toMatch(/looks like a student email/);
    });

    test("explains the format for malformed emails", () => {
        expect(emailProblemForRole("mrudang.shah.ce@ddu.ac.in", "FACULTY")).toMatch(/First name \+ "\." \+ department code/);
        expect(emailProblemForRole("24ce1234@ddu.ac.in", "STUDENT")).toMatch(/2-digit batch/);
        expect(emailProblemForRole("mrudang@gmail.com", "FACULTY")).toMatch(/@ddu\.ac\.in/);
    });
});
