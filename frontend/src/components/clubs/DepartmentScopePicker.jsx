import { Building2, Check, CheckCircle2, Globe2 } from "lucide-react";
import { Field } from "../ui";

const MODES = [
    { all: false, label: "Specific departments", description: "For one or more departments", icon: Building2 },
    { all: true, label: "All departments", description: "Open to students from every department", icon: Globe2 }
];

/**
 * Chooses who a club is for: all departments, or a set of departments.
 * `value` is { allDepartments, departmentCodes }.
 */
export const DepartmentScopePicker = ({ value, onChange, departments, error, className = "" }) => {
    const toggle = (code) => {
        const codes = value.departmentCodes.includes(code) ? value.departmentCodes.filter((c) => c !== code) : [...value.departmentCodes, code];
        onChange({ ...value, departmentCodes: codes });
    };

    return (
        <Field
            className={className}
            label="Who is the club for?"
            hint={
                value.allDepartments
                    ? "Students from every department can join, and any faculty member can mentor it."
                    : "Only students from the selected departments can join, and the faculty mentor must be from one of them."
            }
            error={error}
            required
        >
            <div className="stack-sm">
                <div className="role-picker" role="radiogroup" aria-label="Club departments">
                    {MODES.map(({ all, label, description, icon: Icon }) => {
                        const selected = value.allDepartments === all;
                        return (
                            <button
                                key={label}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={`role-option ${selected ? "selected" : ""}`}
                                onClick={() => onChange({ ...value, allDepartments: all })}
                            >
                                <Icon size={20} />
                                <span>
                                    <strong>{label}</strong>
                                    <small>{description}</small>
                                </span>
                                {selected && <CheckCircle2 size={16} className="role-check" />}
                            </button>
                        );
                    })}
                </div>

                {!value.allDepartments && (
                    <div className="dept-options" role="group" aria-label="Departments">
                        {departments.map((department) => {
                            const selected = value.departmentCodes.includes(department.code);
                            return (
                                <button
                                    key={department.code}
                                    type="button"
                                    aria-pressed={selected}
                                    className={`dept-option ${selected ? "selected" : ""}`}
                                    onClick={() => toggle(department.code)}
                                    title={department.name}
                                >
                                    {selected && <Check size={13} />}
                                    {department.name} <span className="subtle">({department.code})</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Field>
    );
};
