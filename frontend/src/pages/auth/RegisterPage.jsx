import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Briefcase, CheckCircle2, GraduationCap, UserPlus } from "lucide-react";
import { authApi } from "../../api/endpoints";
import { Alert, Badge, Button, Input } from "../../components/ui";
import { FormSection, Stepper, WizardHeader, WizardNav } from "../../components/forms/Wizard";
import { detectAccountType, emailProblemForRole, passwordProblems, ROLE_EMAIL_RULES } from "../../lib/validation";
import { formatPhone, normalizePhone } from "../../lib/phone";

const ROLES = [
    { value: "STUDENT", label: "Student", icon: GraduationCap, description: "Join clubs and register for events" },
    { value: "FACULTY", label: "Faculty", icon: Briefcase, description: "Review club requests and mentor clubs" }
];

const STEPS = [
    { key: "role", label: "Choose your role", fields: [] },
    { key: "details", label: "Your details", fields: ["name", "email", "phone"] },
    { key: "password", label: "Password & review", fields: ["password", "confirm"] }
];

const RolePicker = ({ value, onChange }) => (
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
);

const verifyPath = (email) => `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`;

const RegisterPage = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [reached, setReached] = useState(0);
    const [role, setRole] = useState("STUDENT");
    const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
    const [touched, setTouched] = useState({});
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const detected = useMemo(() => detectAccountType(form.email), [form.email]);
    const problems = passwordProblems(form.password);
    const rule = ROLE_EMAIL_RULES[role];
    const phone = normalizePhone(form.phone);

    const errors = {
        name: form.name.trim().length < 2 ? "Enter your full name" : null,
        email: emailProblemForRole(form.email, role),
        phone: !form.phone.trim() ? "Enter your mobile number" : !phone ? "Enter a 10-digit Indian mobile number" : null,
        password: problems.length ? `Password needs ${problems.join(", ")}` : null,
        confirm: form.confirm !== form.password ? "Passwords do not match" : null
    };
    const stepProblems = Object.fromEntries(STEPS.map((entry, index) => [entry.key, index < reached && entry.fields.some((field) => errors[field])]));

    const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
    const blur = (field) => () => setTouched((prev) => ({ ...prev, [field]: true }));

    const chooseRole = (next) => {
        setRole(next);
        setError(null);
    };

    const goTo = (index) => {
        setStep(index);
        setReached((prev) => Math.max(prev, index));
    };

    // Continue only when this step is complete; otherwise show what's missing.
    const next = () => {
        const fields = STEPS[step].fields;
        setTouched((prev) => ({ ...prev, ...Object.fromEntries(fields.map((field) => [field, true])) }));
        if (fields.some((field) => errors[field])) return;
        goTo(step + 1);
    };

    const submit = async (event) => {
        event.preventDefault();
        if (step < STEPS.length - 1) {
            next();
            return;
        }
        setTouched({ name: true, email: true, phone: true, password: true, confirm: true });
        const firstBad = STEPS.findIndex((entry) => entry.fields.some((field) => errors[field]));
        if (firstBad !== -1) {
            setStep(firstBad);
            return;
        }
        setPending(true);
        setError(null);
        try {
            const response = await authApi.register({ name: form.name.trim(), email: form.email.trim(), phone, password: form.password, accountType: role });
            navigate(verifyPath(form.email), { state: { otp: response?.data?.otp, sentAt: Date.now() } });
        } catch (err) {
            setError(err);
            setPending(false);
        }
    };

    const matchesRole = detected?.type === role;
    const roleLabel = role === "FACULTY" ? "faculty" : "student";

    return (
        <div className="signup">
            <WizardHeader eyebrow="Create account" title="Join CampusConnect" />
            <Stepper steps={STEPS} current={step} onStep={goTo} reached={reached} problems={stepProblems} />

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

                {step === 0 && (
                    <FormSection title="Choose your role" description="This decides what you can do. Students join clubs and events; faculty mentor clubs.">
                        <RolePicker value={role} onChange={chooseRole} />
                    </FormSection>
                )}

                {step === 1 && (
                    <FormSection title="Your details" description="Use your university email — we send a code to it to confirm it's you.">
                        <div className="stack">
                            <Input
                                label="Full name"
                                autoComplete="name"
                                value={form.name}
                                onChange={update("name")}
                                onBlur={blur("name")}
                                error={touched.name && errors.name}
                                required
                                placeholder="As on your ID card"
                            />
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
                                label="Mobile number"
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel-national"
                                placeholder="98765 43210"
                                value={form.phone}
                                onChange={update("phone")}
                                onBlur={blur("phone")}
                                error={touched.phone && errors.phone}
                                hint={
                                    role === "FACULTY"
                                        ? "Only club members and staff can see it."
                                        : "Only club leaders, your clubs and faculty can see it — never other students."
                                }
                                required
                            />
                        </div>
                    </FormSection>
                )}

                {step === 2 && (
                    <FormSection title="Password & review" description="Choose a password, then check your details.">
                        <div className="stack">
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
                            <dl className="review-list">
                                {[
                                    ["Role", role === "FACULTY" ? "Faculty" : "Student", 0],
                                    ["Name", form.name.trim(), 1],
                                    ["Email", form.email.trim(), 1],
                                    ["Mobile", phone ? formatPhone(phone) : form.phone, 1]
                                ].map(([label, value, target]) => (
                                    <div key={label}>
                                        <dt>{label}</dt>
                                        <dd>{value || "—"}</dd>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            type="button"
                                            onClick={() => setStep(target)}
                                            aria-label={`Change ${label.toLowerCase()}`}
                                        >
                                            Change
                                        </Button>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    </FormSection>
                )}

                <WizardNav
                    current={step}
                    total={STEPS.length}
                    onBack={() => setStep((value) => value - 1)}
                    onNext={next}
                    final={
                        <Button type="submit" loading={pending}>
                            <UserPlus size={17} /> Create {roleLabel} account
                        </Button>
                    }
                />
            </form>
            <p className="auth-footer">
                Already have an account? <Link to="/login">Sign in</Link>
            </p>
        </div>
    );
};

export default RegisterPage;
