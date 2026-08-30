const {
    parseStudentEmail,
    parseFacultyEmail,
    intervalsOverlap
} = require("../utils/UniversityRules");

describe("university email parsing", () => {
    test("parses student emails such as 24CE1234", () => {
        const parsed = parseStudentEmail("24CE1234@ddu.ac.in");
        expect(parsed).toEqual({
            batchCode: "24",
            departmentCode: "CE",
            identifier: "1234"
        });
    });

    test("rejects faculty-like local parts as student emails", () => {
        expect(parseStudentEmail("bhavika.ce@ddu.ac.in")).toBeNull();
    });

    test("parses faculty emails such as name.ce", () => {
        const parsed = parseFacultyEmail("bhavika.ce@ddu.ac.in");
        expect(parsed).toEqual({
            departmentCode: "CE",
            namePart: "bhavika"
        });
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
