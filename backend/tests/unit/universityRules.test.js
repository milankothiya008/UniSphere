const {
    parseStudentEmail,
    parseFacultyEmail,
    isValidUniversityEmailFormat,
    intervalsOverlap
} = require("../../utils/UniversityRules");

describe("university email parsing", () => {
    test("parses student emails: batch, department, 3-letter identity, 3-digit number", () => {
        expect(parseStudentEmail("24ceuog001@ddu.ac.in")).toEqual({
            batchCode: "24",
            departmentCode: "CE",
            identifier: "UOG001"
        });
    });

    test("supports 2-4 letter department codes", () => {
        expect(parseStudentEmail("24CSEUOG015@ddu.ac.in").departmentCode).toBe("CSE");
        expect(parseStudentEmail("23MECHABC999@ddu.ac.in").departmentCode).toBe("MECH");
    });

    test.each(["24ce1234", "24ceuog01", "24ceuog0012", "24ceu0g001", "2ceuog001", "24cuog001", "24ceuog001x"])(
        "rejects malformed student email %s",
        (local) => {
            expect(parseStudentEmail(`${local}@ddu.ac.in`)).toBeNull();
        }
    );

    test("parses faculty emails: first name, dot, department", () => {
        expect(parseFacultyEmail("brij.ce@ddu.ac.in")).toEqual({ departmentCode: "CE", namePart: "brij" });
        expect(parseStudentEmail("brij.ce@ddu.ac.in")).toBeNull();
    });

    test.each(["brij.patel.ce", "brij1.ce", "brij.c", "brij.cehme", ".ce", "brij"])("rejects malformed faculty email %s", (local) => {
        expect(parseFacultyEmail(`${local}@ddu.ac.in`)).toBeNull();
    });

    test("format check also requires the university domain", () => {
        expect(isValidUniversityEmailFormat("24ceuog001@ddu.ac.in")).toBe(true);
        expect(isValidUniversityEmailFormat("brij.ce@ddu.ac.in")).toBe(true);
        expect(isValidUniversityEmailFormat("24ceuog001@gmail.com")).toBe(false);
    });
});

describe("venue interval overlap", () => {
    const at = (hour) => new Date(`2026-08-30T${String(hour).padStart(2, "0")}:00:00`);

    test("detects overlapping intervals", () => {
        expect(intervalsOverlap(at(10), at(12), at(11), at(13))).toBe(true);
    });

    test("allows back-to-back intervals", () => {
        expect(intervalsOverlap(at(10), at(12), at(12), at(14))).toBe(false);
    });

    test("detects contained intervals", () => {
        expect(intervalsOverlap(at(10), at(14), at(11), at(12))).toBe(true);
    });
});

describe("university-local date and time", () => {
    const { combineDateAndTime, toDateKey } = require("../../utils/UniversityRules");

    test("combines a date and HH:mm in the university timezone (+05:30)", () => {
        expect(combineDateAndTime("2026-10-05", "10:00").toISOString()).toBe("2026-10-05T04:30:00.000Z");
    });

    test("uses the calendar date of a stored UTC-midnight date", () => {
        expect(toDateKey(new Date("2026-10-05T00:00:00Z"))).toBe("2026-10-05");
    });

    test("rejects malformed times", () => {
        expect(() => combineDateAndTime("2026-10-05", "25:00")).toThrow();
    });
});
