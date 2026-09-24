import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Briefcase, CheckCircle2, GraduationCap, UserPlus } from "lucide-react";
import { authApi } from "../../api/endpoints";
import { Alert, Badge, Button, Field, Input } from "../../components/ui";
import { detectAccountType, emailProblemForRole, passwordProblems, ROLE_EMAIL_RULES } from "../../lib/validation";

const ROLES = [
    { value: "STUDENT", label: "Student", icon: GraduationCap, description: "Join clubs and register for events" },
    { value: "FACULTY", label: "Faculty", icon: Briefcase, description: "Review club requests and mentor clubs" }
];

const RolePicker = ({ value, onChange }) => (
    <Field label="I am registering as" required>
        <div className="role-picker" role="radiogroup" aria-label="Account type">
            {ROLES.map(({ value: role, label, icon: Icon, description }) => (
                <button
                    key={role}
                    type="button"
                    role="radio"
                    aria-checked={value === role}
                    className={`role-option ${value === role ? "selected" : ""}`}
                    onClick={() => onChange(role)}
                >
                    <Icon size={20} />
                    <span>
                        <strong>{label}</strong>
                        <small>{description}</small>
                    </span>
                    {value === role && <CheckCircle2 size={16} className="role-check" />}
                </button>
            ))}
        </div>
    </Field>
);

const verifyPath = (email) => `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`;

const RegisterPage = () => {
    const navigate = useNavigate();
    const [role, setRole] = useState("STUDENT");
    const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
    const [touched, setTouched] = useState({});
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const detected = useMemo(() => detectAccountType(form.email), [form.email]);
    const problems = passwordProblems(form.password);
    const rule = ROLE_EMAIL_RULES[role];

    const errors = {
        name: form.name.trim().length < 2 ? "Enter your full name" : null,
        email: emailProblemForRole(form.email, role),
        password: problems.length ? `Password needs ${problems.join(", ")}` : null,
        confirm: form.confirm !== form.password ? "Passwords do not match" : null
    };
    const valid = !Object.values(errors).some(Boolean);

    const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
    const blur = (field) => () => setTouched((prev) => ({ ...prev, [field]: true }));

    const chooseRole = (next) => {
        setRole(next);
        setError(null);
    };

    const submit = async (event) => {
        event.preventDefault();
        setTouched({ name: true, email: true, password: true, confirm: true });
        if (!valid) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            const response = await authApi.register({ name: form.name.trim(), email: form.email.trim(), password: form.password, accountType: role });
            navigate(verifyPath(form.email), { state: { otp: response?.data?.otp, sentAt: Date.now() } });
        } catch (err) {
            setError(err);
            setPending(false);
        }
    };

    const matchesRole = detected?.type === role;

    return (
        <>
            <h2>Create your account</h2>
            <p className="lead">Sign up with your university email.</p>
            <form className="stack" onSubmit={submit} noValidate>
                {error && (
                    <Alert type="error" title={error.code === "UNVERIFIED_EMAIL" ? "Already registered" : undefined}>
                        {error.message}
                        {error.code === "UNVERIFIED_EMAIL" && (
                            <>
                                {" "}
                                <Link to={verifyPath(form.email)} style={{ fontWeight: 600 }}>
                                    Enter your code
                                </Link>
                            </>
                        )}
                    </Alert>
                )}
                <RolePicker value={role} onChange={chooseRole} />
                <Input label="Full name" autoComplete="name" value={form.name} onChange={update("name")} onBlur={blur("name")} error={touched.name && errors.name} required />
                <Input
                    label={role === "FACULTY" ? "Faculty email" : "Student email"}
                    type="email"
                    autoComplete="email"
                    placeholder={rule.example}
                    value={form.email}
                    onChange={update("email")}
                    onBlur={blur("email")}
                    error={touched.email && errors.email}
                    hint={rule.hint}
                    required
                />
                {matchesRole && (
                    <div className="row">
                        {detected.type === "STUDENT" ? (
                            <Badge tone="ink">
                                <GraduationCap size={13} /> Student · {detected.department} · Batch {detected.batch} · ID {detected.identity}
                            </Badge>
                        ) : (
                            <Badge tone="gold">
                                <Briefcase size={13} /> Faculty · {detected.department}
                            </Badge>
                        )}
                    </div>
                )}
                <Input
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={update("password")}
                    onBlur={blur("password")}
                    error={touched.password && errors.password}
                    hint="At least 8 characters, with a letter and a number"
                    required
                />
                <Input
                    label="Confirm password"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={update("confirm")}
                    onBlur={blur("confirm")}
                    error={touched.confirm && errors.confirm}
                    required
                />
                <Button type="submit" size="lg" block loading={pending}>
                    <UserPlus size={17} /> Create {role === "FACULTY" ? "faculty" : "student"} account
                </Button>
            </form>
            <p className="auth-footer">
                Already have an account? <Link to="/login">Sign in</Link>
            </p>
        </>
    );
};

export default RegisterPage;
