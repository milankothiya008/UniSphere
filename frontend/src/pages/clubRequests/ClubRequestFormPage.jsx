import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Send, X } from "lucide-react";
import { clubRequestApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { Alert, ApiErrorAlert, AsyncContent, Avatar, Button, ErrorState, Field, Input, PageHeader, Select, Textarea, UserPicker } from "../../components/ui";
import { FormSection, Stepper, WizardHeader, WizardNav } from "../../components/forms/Wizard";
import { DepartmentScopePicker } from "../../components/clubs/DepartmentScopePicker";
import { CLUB_CATEGORIES } from "../../lib/constants";
import { departmentsLabel, humanize } from "../../lib/format";
import { belongsToScope, scopeDepartments } from "../../lib/eligibility";

const blank = {
    name: "",
    category: "TECHNOLOGY",
    description: "",
    purpose: "",
    proposedActivities: "",
    reason: ""
};

const LIMITS = { name: [3, 120], description: [10, 4000], purpose: [10, 2000], proposedActivities: [10, 4000], reason: [10, 2000] };

const STEPS = [
    { key: "club", label: "The club", fields: ["name", "scope"] },
    { key: "about", label: "Purpose & plans", fields: ["description", "purpose", "proposedActivities", "reason"] },
    { key: "people", label: "People", fields: ["founders", "mentor"] },
    { key: "review", label: "Review & submit", fields: [] }
];

const ClubRequestFormPage = () => {
    const { id } = useParams();
    const isEdit = Boolean(id);
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useAuth();
    const { reference } = useWorkspace();

    const existing = useApi(() => clubRequestApi.get(id), [id], { enabled: isEdit });
    const [form, setForm] = useState(blank);
    const [scope, setScope] = useState({ allDepartments: false, departmentCodes: user.departmentCode ? [user.departmentCode] : [] });
    const [founders, setFounders] = useState([]);
    const [mentor, setMentor] = useState(null);
    const [touched, setTouched] = useState(false);
    const [step, setStep] = useState(0);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const request = existing.data;

    useEffect(() => {
        if (request) {
            setForm({
                name: request.name,
                category: request.category,
                description: request.description,
                purpose: request.purpose,
                proposedActivities: request.proposedActivities,
                reason: request.reason
            });
            setScope({ allDepartments: Boolean(request.allDepartments), departmentCodes: request.departmentCodes || [] });
            setFounders(request.foundingMembers || []);
            setMentor(request.proposedMentor || null);
        }
    }, [request]);

    const errors = Object.fromEntries(
        Object.entries(LIMITS)
            .filter(([field, [min]]) => form[field].trim().length < min)
            .map(([field, [min]]) => [field, `At least ${min} characters`])
    );
    if (!scope.allDepartments && !scope.departmentCodes.length) {
        errors.scope = "Choose at least one department, or open the club to all departments";
    } else if (!belongsToScope(user, scope)) {
        errors.scope = `You are in ${user.departmentCode}, so the club must include ${user.departmentCode} or be open to all departments.`;
    }
    const outsideFounders = founders.filter((founder) => !belongsToScope(founder, scope));
    if (outsideFounders.length) {
        errors.founders = `Only ${departmentsLabel(scope)} students can be founding members: remove ${outsideFounders.map((f) => `${f.name} (${f.departmentCode})`).join(", ")} or add their department.`;
    }
    if (mentor && !belongsToScope(mentor, scope)) {
        errors.mentor = `${mentor.name} is from ${mentor.departmentCode}. Choose a mentor from ${departmentsLabel(scope)}, or add ${mentor.departmentCode} to the club's departments.`;
    }

    const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

    const submit = async (event) => {
        event.preventDefault();
        if (step < STEPS.length - 1) {
            next();
            return;
        }
        setTouched(true);
        const firstBad = STEPS.findIndex((entry) => entry.fields.some((field) => errors[field]));
        if (firstBad !== -1) {
            goTo(firstBad);
            return;
        }
        setPending(true);
        setError(null);
        try {
            const body = {
                ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])),
                allDepartments: scope.allDepartments,
                departmentCodes: scope.allDepartments ? [] : scope.departmentCodes,
                foundingMemberEmails: founders.map((founder) => founder.email)
            };
            if (isEdit) {
                await clubRequestApi.update(id, body);
                await clubRequestApi.resubmit(id);
                toast.success("Changes saved and resubmitted for faculty review");
                navigate(`/club-requests/${id}`);
            } else {
                const response = await clubRequestApi.create({ ...body, proposedMentor: mentor?._id || undefined });
                toast.success("Club request submitted for faculty review");
                navigate(`/club-requests/${response.data._id}`);
            }
        } catch (err) {
            setError(err);
            window.scrollTo({ top: 0, behavior: "smooth" });
        } finally {
            setPending(false);
        }
    };

    if (isEdit && existing.error) {
        return <ErrorState error={existing.error} />;
    }
    if (isEdit && request && (request.status !== "NEEDS_CHANGES" || request.requester?._id !== user._id)) {
        return <ErrorState error={{ status: 403, message: "Only the requesting student can edit a request after changes are requested." }} />;
    }

    const fieldError = (field) => (touched ? errors[field] : undefined);
    const stepProblems = Object.fromEntries(STEPS.map((entry) => [entry.key, touched && entry.fields.some((field) => errors[field])]));
    const goTo = (index) => {
        setStep(index);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };
    // Continue only when this step is complete; otherwise point at what's missing.
    function next() {
        if (STEPS[step].fields.some((field) => errors[field])) {
            setTouched(true);
            return;
        }
        goTo(step + 1);
    }
    const review = [
        ["Club name", form.name.trim(), 0],
        ["Category", humanize(form.category), 0],
        ["Departments", scope.allDepartments ? "All departments" : departmentsLabel(scope), 0],
        ["Description", form.description.trim(), 1],
        ["Purpose", form.purpose.trim(), 1],
        ["Proposed activities", form.proposedActivities.trim(), 1],
        ["Why it's needed", form.reason.trim(), 1],
        ["Founding members", [user.name, ...founders.map((founder) => founder.name)].join(", "), 2],
        ...(isEdit ? [] : [["Preferred mentor", mentor?.name || "Any faculty member", 2]])
    ];

    return (
        <AsyncContent loading={isEdit && existing.loading}>
            <WizardHeader
                eyebrow={isEdit ? "Update request" : "New club"}
                title={isEdit ? `Update “${request?.name || ""}”` : "Start a new club"}
                back={
                    <PageHeader
                        back={isEdit ? { to: `/club-requests/${id}`, label: "Back to request" } : { to: "/club-requests", label: "Club requests" }}
                        title=""
                    />
                }
            />

            <form className="wiz stack-lg" onSubmit={submit} noValidate>
                {request?.reviewComment && (
                    <Alert type="warning" title="Changes requested">
                        {request.reviewComment}
                    </Alert>
                )}
                <ApiErrorAlert error={error} />

                <Stepper steps={STEPS} current={step} reached={STEPS.length - 1} onStep={goTo} problems={stepProblems} />

                {step === 0 && (
                    <FormSection title="The club" description="Its name, what kind of club it is, and which departments' students can join.">
                        <div className="form-grid">
                            <Input
                                className="span-2"
                                label="Club name"
                                value={form.name}
                                onChange={set("name")}
                                maxLength={120}
                                error={fieldError("name")}
                                required
                                placeholder="e.g. Robotics Club"
                            />
                            <Select
                                label="Category"
                                value={form.category}
                                onChange={set("category")}
                                options={CLUB_CATEGORIES.map((value) => ({ value, label: humanize(value) }))}
                            />
                            <DepartmentScopePicker
                                className="span-2"
                                value={scope}
                                onChange={setScope}
                                departments={reference.departments}
                                error={errors.scope || (isEdit ? errors.mentor : undefined)}
                            />
                        </div>
                    </FormSection>
                )}

                {step === 1 && (
                    <FormSection title="Purpose & plans" description="Faculty read this to decide. A few clear sentences for each is enough.">
                        <div className="form-grid">
                            <Textarea
                                className="span-2"
                                label="Description"
                                value={form.description}
                                onChange={set("description")}
                                rows={4}
                                maxLength={4000}
                                error={fieldError("description")}
                                required
                            />
                            <Textarea
                                className="span-2"
                                label="Purpose"
                                hint="What will members gain?"
                                value={form.purpose}
                                onChange={set("purpose")}
                                rows={3}
                                maxLength={2000}
                                error={fieldError("purpose")}
                                required
                            />
                            <Textarea
                                className="span-2"
                                label="Proposed activities"
                                hint="Events, sessions or projects you plan to run"
                                value={form.proposedActivities}
                                onChange={set("proposedActivities")}
                                rows={4}
                                maxLength={4000}
                                error={fieldError("proposedActivities")}
                                required
                            />
                            <Textarea
                                className="span-2"
                                label="Why is this club needed?"
                                value={form.reason}
                                onChange={set("reason")}
                                rows={3}
                                maxLength={2000}
                                error={fieldError("reason")}
                                required
                            />
                        </div>
                    </FormSection>
                )}

                {step === 2 && (
                    <FormSection title="People" description="Who's starting the club with you, and the faculty member you'd like as mentor.">
                        <div className="stack">
                            <Field
                                label="Founding members"
                                hint={`Verified ${scope.allDepartments ? "" : `${departmentsLabel(scope)} `}students who are starting the club with you. They become members when the club is approved.`}
                                error={errors.founders}
                            >
                                <div className="row" style={{ marginBottom: founders.length ? 6 : 0 }}>
                                    <span className="chip">
                                        <Avatar name={user.name} src={user.avatar} size="sm" /> {user.name} (you)
                                    </span>
                                    {founders.map((founder) => (
                                        <span key={founder._id} className="chip">
                                            {founder.name}
                                            <button
                                                type="button"
                                                onClick={() => setFounders((list) => list.filter((f) => f._id !== founder._id))}
                                                aria-label={`Remove ${founder.name}`}
                                            >
                                                <X size={13} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            </Field>
                            <UserPicker
                                accountType="STUDENT"
                                departments={scopeDepartments(scope)}
                                placeholder="Add a founding member"
                                exclude={[user._id, ...founders.map((f) => f._id)]}
                                onSelect={(student) => setFounders((list) => (list.length >= 20 ? list : [...list, student]))}
                            />

                            {!isEdit && (
                                <>
                                    <Field
                                        label="Preferred faculty mentor (optional)"
                                        hint={`If you've already spoken to a faculty member, name them — only they will review it and they'll become your mentor. Otherwise any faculty member from ${
                                            scope.allDepartments ? "any department" : departmentsLabel(scope) || "the club's departments"
                                        } can pick it up.`}
                                        error={errors.mentor}
                                    >
                                        {mentor && (
                                            <span className="chip">
                                                {mentor.name}
                                                <button type="button" onClick={() => setMentor(null)} aria-label="Remove reviewer">
                                                    <X size={13} />
                                                </button>
                                            </span>
                                        )}
                                    </Field>
                                    {!mentor && (
                                        <UserPicker
                                            accountType="FACULTY"
                                            departments={scopeDepartments(scope)}
                                            placeholder={
                                                scope.allDepartments
                                                    ? "Search all faculty"
                                                    : `Search faculty from ${departmentsLabel(scope) || "the selected departments"}`
                                            }
                                            onSelect={setMentor}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </FormSection>
                )}

                {step === 3 && (
                    <FormSection title="Review & submit" description="Check everything once more. Faculty can ask for changes before approving.">
                        <dl className="review-list">
                            {review.map(([label, value, target]) => {
                                const bad = STEPS[target].fields.some((field) => errors[field]);
                                return (
                                    <div key={label} className={bad ? "has-problem" : ""}>
                                        <dt>{label}</dt>
                                        <dd className="pre-line">{value || "—"}</dd>
                                        <Button variant="ghost" size="sm" onClick={() => goTo(target)} aria-label={`Change ${label.toLowerCase()}`}>
                                            Change
                                        </Button>
                                    </div>
                                );
                            })}
                        </dl>
                    </FormSection>
                )}

                <WizardNav
                    current={step}
                    total={STEPS.length}
                    onBack={() => goTo(step - 1)}
                    onNext={next}
                    final={
                        <>
                            <Button variant="secondary" onClick={() => navigate(-1)} disabled={pending}>
                                Cancel
                            </Button>
                            <Button type="submit" loading={pending}>
                                <Send size={16} /> {isEdit ? "Save & resubmit" : "Submit for faculty review"}
                            </Button>
                        </>
                    }
                />
            </form>
        </AsyncContent>
    );
};

export default ClubRequestFormPage;
