import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepartmentScopePicker } from "./DepartmentScopePicker";
import { belongsToScope } from "../../lib/eligibility";
import { departmentsLabel } from "../../lib/format";

const departments = [
    { code: "CE", name: "Computer Engineering" },
    { code: "IT", name: "Information Technology" },
    { code: "EC", name: "Electronics & Communication" }
];

const Harness = ({ onChange }) => {
    const [value, setValue] = useState({ allDepartments: false, departmentCodes: ["CE"] });
    return (
        <DepartmentScopePicker
            value={value}
            departments={departments}
            onChange={(next) => {
                setValue(next);
                onChange(next);
            }}
        />
    );
};

describe("DepartmentScopePicker", () => {
    test("selects several departments, or opens the club to all", async () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        expect(screen.getByRole("button", { name: /computer engineering/i })).toHaveAttribute("aria-pressed", "true");
        await userEvent.click(screen.getByRole("button", { name: /information technology/i }));
        expect(onChange).toHaveBeenLastCalledWith({ allDepartments: false, departmentCodes: ["CE", "IT"] });

        await userEvent.click(screen.getByRole("radio", { name: /all departments/i }));
        expect(onChange).toHaveBeenLastCalledWith({ allDepartments: true, departmentCodes: ["CE", "IT"] });
        expect(screen.queryByRole("group", { name: "Departments" })).not.toBeInTheDocument();
    });
});

describe("club department rule", () => {
    const ceFaculty = { departmentCode: "CE" };

    test("mentors and members must belong to one of the club's departments unless it is for all departments", () => {
        expect(belongsToScope(ceFaculty, { allDepartments: false, departmentCodes: ["CE", "IT"] })).toBe(true);
        expect(belongsToScope(ceFaculty, { allDepartments: false, departmentCodes: ["IT"] })).toBe(false);
        expect(belongsToScope(ceFaculty, { allDepartments: true, departmentCodes: [] })).toBe(true);
    });

    test("labels the club's departments", () => {
        expect(departmentsLabel({ allDepartments: true, departmentCodes: [] })).toBe("All departments");
        expect(departmentsLabel({ allDepartments: false, departmentCodes: ["CE", "IT"] })).toBe("CE, IT");
    });
});
