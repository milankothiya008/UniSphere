export const UNIVERSITY_DOMAIN = import.meta.env.VITE_UNIVERSITY_DOMAIN || "ddu.ac.in";

export const STUDENT_EMAIL_EXAMPLE = `24ceuog001@${UNIVERSITY_DOMAIN}`;
export const FACULTY_EMAIL_EXAMPLE = `mrudang.ce@${UNIVERSITY_DOMAIN}`;
export const EMAIL_FORMAT_HELP = `Use your university email — students: ${STUDENT_EMAIL_EXAMPLE} (batch, department, 3-letter identity, 3-digit number); faculty: ${FACULTY_EMAIL_EXAMPLE} (first name, dot, department).`;

export const ROLE_EMAIL_RULES = {
    STUDENT: {
        example: STUDENT_EMAIL_EXAMPLE,
        hint: `2-digit batch + department code + 3 letters + 3 digits, e.g. ${STUDENT_EMAIL_EXAMPLE}`
    },
    FACULTY: {
        example: FACULTY_EMAIL_EXAMPLE,
        hint: `First name + "." + department code, e.g. ${FACULTY_EMAIL_EXAMPLE}`
    }
};

// Explains why an email doesn't fit the chosen role; null when it matches.
export const emailProblemForRole = (email, role) => {
    const value = String(email).trim();
    if (!value) {
        return "Enter your university email";
    }
    if (!value.toLowerCase().endsWith(`@${UNIVERSITY_DOMAIN}`)) {
        return `Use your @${UNIVERSITY_DOMAIN} university email`;
    }
    const detected = detectAccountType(value);
    if (detected?.type === role) {
        return null;
    }
    const rule = ROLE_EMAIL_RULES[role];
    if (detected) {
        const other = detected.type === "FACULTY" ? "faculty" : "student";
        return `This looks like a ${other} email. Choose ${detected.type === "FACULTY" ? "Faculty" : "Student"} above, or use the ${role === "FACULTY" ? "faculty" : "student"} format: ${rule.example}`;
    }
    return `${role === "FACULTY" ? "Faculty" : "Student"} email format: ${rule.hint}`;
};

// Mirrors the backend rules (utils/UniversityRules.js) so users see which account type they'll get.
const STUDENT_PATTERN = /^(\d{2})([a-z]{2,4})([a-z]{3})(\d{3})$/;
const FACULTY_PATTERN = /^([a-z]+)\.([a-z]{2,4})$/;

export const detectAccountType = (email) => {
    const [local, domain, extra] = String(email).trim().toLowerCase().split("@");
    if (!local || domain !== UNIVERSITY_DOMAIN || extra !== undefined) {
        return null;
    }
    const student = local.match(STUDENT_PATTERN);
    if (student) {
        return { type: "STUDENT", batch: `20${student[1]}`, department: student[2].toUpperCase(), identity: `${student[3]}${student[4]}`.toUpperCase() };
    }
    const faculty = local.match(FACULTY_PATTERN);
    if (faculty) {
        return { type: "FACULTY", department: faculty[2].toUpperCase() };
    }
    return null;
};

export const passwordProblems = (password = "") => {
    const problems = [];
    if (password.length < 8) problems.push("at least 8 characters");
    if (!/[A-Za-z]/.test(password)) problems.push("a letter");
    if (!/\d/.test(password)) problems.push("a number");
    return problems;
};

export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
