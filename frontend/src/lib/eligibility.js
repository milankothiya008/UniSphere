import { batchLabel } from "./format";

// Mirrors the backend eligibility rule so students see why they can't register before trying.
export const eligibilityProblem = (user, event) => {
    if (!user) {
        return null;
    }
    const { departments = [], batches = [] } = event.eligibility || {};
    if (departments.length && !departments.includes(user.departmentCode)) {
        return `Open to ${departments.join(", ")} students only.`;
    }
    if (batches.length && !batches.includes(user.batchCode)) {
        return `Open to batch ${batches.map(batchLabel).join(", ")} only.`;
    }
    return null;
};

// Mirrors the backend club department rule: mentors and members must be from one of the club's
// departments, unless the club is open to all departments.
export const belongsToScope = (user, scope) => Boolean(scope.allDepartments) || (scope.departmentCodes || []).includes(user?.departmentCode);

// Department codes to restrict a user search to, or undefined for an all-departments club.
export const scopeDepartments = (scope) => (scope.allDepartments ? undefined : scope.departmentCodes);

export const isLive = (event, now = Date.now()) =>
    event.status === "PUBLISHED" && new Date(event.startAt).getTime() <= now && new Date(event.endAt).getTime() > now;

export const isPast = (event, now = Date.now()) => event.status === "COMPLETED" || new Date(event.endAt).getTime() <= now;
