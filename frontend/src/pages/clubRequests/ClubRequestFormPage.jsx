import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Send, X } from "lucide-react";
import { clubRequestApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { Alert, ApiErrorAlert, AsyncContent, Avatar, Button, Card, ErrorState, Field, Input, PageHeader, Select, Textarea, UserPicker } from "../../components/ui";
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
        setTouched(true);
        if (Object.keys(errors).length) {
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

    return (
        <AsyncContent loading={isEdit && existing.loading}>
            <PageHeader
                back={isEdit ? { to: `/club-requests/${id}`, label: "Back to request" } : { to: "/club-requests", label: "Club requests" }}
                title={isEdit ? `Update “${request?.name || ""}”` : "Start a new club"}
            />

            <form className="stack-lg" style={{ maxWidth: 860 }} onSubmit={submit} noValidate>
                {request?.reviewComment && (
                    <Alert type="warning" title="Changes requested">
                        {request.reviewComment}
                    </Alert>
                )}
                <ApiErrorAlert error={error} />

                <Card title="The club">
                    <div className="form-grid">
                        <Input className="span-2" label="Club name" value={form.name} onChange={set("name")} maxLength={120} error={fieldError("name")} required />
                        <Select label="Category" value={form.category} onChange={set("category")} options={CLUB_CATEGORIES.map((value) => ({ value, label: humanize(value) }))} />
                        <DepartmentScopePicker
                            className="span-2"
                            value={scope}
                            onChange={setScope}
                            departments={reference.departments}
                            error={errors.scope || (isEdit ? errors.mentor : undefined)}
                        />
                        <Textarea className="span-2" label="Description" value={form.description} onChange={set("description")} rows={4} maxLength={4000} error={fieldError("description")} required />
                        <Textarea className="span-2" label="Purpose" hint="What will members gain?" value={form.purpose} onChange={set("purpose")} rows={3} maxLength={2000} error={fieldError("purpose")} required />
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
                </Card>

                <Card title="People">
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
                                        <button type="button" onClick={() => setFounders((list) => list.filter((f) => f._id !== founder._id))} aria-label={`Remove ${founder.name}`}>
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
                                        placeholder={scope.allDepartments ? "Search all faculty" : `Search faculty from ${departmentsLabel(scope) || "the selected departments"}`}
                                        onSelect={setMentor}
                                    />
                                )}
                            </>
                        )}
                    </div>
                </Card>

                <div className="form-actions">
                    <Button variant="secondary" onClick={() => navigate(-1)} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" loading={pending}>
                        <Send size={16} /> {isEdit ? "Save & resubmit" : "Submit for faculty review"}
                    </Button>
                </div>
            </form>
        </AsyncContent>
    );
};

export default ClubRequestFormPage;
