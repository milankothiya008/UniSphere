import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, Vote } from "lucide-react";
import { clubApi, electionApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, AsyncContent, Avatar, Button, Input, PageHeader, SearchInput, Segmented, Select, Textarea } from "../../components/ui";
import { FormSection, Stepper, WizardHeader, WizardNav } from "../../components/forms/Wizard";
import { formatDateTime, fromDateTimeInput, toDateTimeInput } from "../../lib/format";

const STEPS = [
    { key: "role", label: "Role" },
    { key: "candidates", label: "Candidates" },
    { key: "timing", label: "Voting time" },
    { key: "review", label: "Review" }
];
const MAX_CANDIDATES = 10;
const DURATIONS = [
    { value: "1", label: "1 day" },
    { value: "3", label: "3 days" },
    { value: "7", label: "1 week" },
    { value: "custom", label: "Custom" }
];
const later = (base, days) => toDateTimeInput(new Date(new Date(base).getTime() + days * 86400000));

// New election (or editing one that hasn't opened yet): the role, the candidates the organiser picks from
// the club's members, and when voting opens and closes.
const ElectionFormPage = () => {
    const { id: clubId } = useParams();
    const [params] = useSearchParams();
    const editId = params.get("edit");
    const navigate = useNavigate();
    const toast = useToast();
    const [step, setStep] = useState(0);
    const [club, setClub] = useState(null);
    const [roles, setRoles] = useState([]);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [error, setError] = useState(null);
    const [pending, setPending] = useState(false);
    const [search, setSearch] = useState("");
    const [form, setForm] = useState({ role: "", title: "", description: "", candidates: [], opensNow: true, opensAt: "", duration: "3", closesAt: "" });
    const set = (patch) => setForm((current) => ({ ...current, ...patch }));

    useEffect(() => {
        let active = true;
        Promise.all([clubApi.get(clubId), clubApi.roles(clubId), clubApi.members(clubId), editId ? electionApi.get(editId) : null])
            .then(([clubResponse, roleResponse, memberResponse, electionResponse]) => {
                if (!active) return;
                setClub(clubResponse.data);
                setRoles((roleResponse.data.roles || []).filter((role) => role.key !== "MEMBER"));
                setMembers(memberResponse.data || []);
                const election = electionResponse?.data;
                if (election) {
                    set({
                        role: election.role,
                        title: election.title,
                        description: election.description,
                        candidates: election.candidates.map((candidate) => ({ user: candidate.user._id, statement: candidate.statement || "" })),
                        opensNow: false,
                        opensAt: toDateTimeInput(election.opensAt),
                        duration: "custom",
                        closesAt: toDateTimeInput(election.closesAt)
                    });
                }
            })
            .catch((err) => active && setLoadError(err))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [clubId, editId]);

    const role = roles.find((item) => item.key === form.role);
    const opensAt = form.opensNow ? new Date().toISOString() : fromDateTimeInput(form.opensAt);
    const closesAt =
        form.duration === "custom"
            ? fromDateTimeInput(form.closesAt)
            : opensAt
              ? new Date(new Date(opensAt).getTime() + Number(form.duration) * 86400000).toISOString()
              : "";
    const memberById = useMemo(() => new Map(members.map((member) => [member.user._id, member])), [members]);
    const shown = members.filter((member) => member.user.name.toLowerCase().includes(search.trim().toLowerCase()));
    const chosen = (userId) => form.candidates.some((candidate) => candidate.user === userId);

    const toggleCandidate = (userId) =>
        set({
            candidates: chosen(userId)
                ? form.candidates.filter((candidate) => candidate.user !== userId)
                : form.candidates.length < MAX_CANDIDATES
                  ? [...form.candidates, { user: userId, statement: "" }]
                  : form.candidates
        });
    const setStatement = (userId, statement) =>
        set({ candidates: form.candidates.map((candidate) => (candidate.user === userId ? { ...candidate, statement } : candidate)) });

    const problems = {
        role: !form.role ? "Choose the role" : null,
        candidates: form.candidates.length < 2 ? "Choose at least 2 candidates" : null,
        timing:
            !form.opensNow && !form.opensAt
                ? "Choose when voting opens"
                : !closesAt
                  ? "Choose when voting closes"
                  : new Date(closesAt) - new Date(opensAt) < 10 * 60000
                    ? "Keep voting open for at least 10 minutes"
                    : null
    };
    const stepProblems = Object.fromEntries(Object.entries(problems).filter(([, value]) => value));
    const next = () => {
        const problem = problems[STEPS[step].key];
        if (problem) {
            setError({ message: problem });
            return;
        }
        setError(null);
        setStep(step + 1);
    };

    const submit = async (event) => {
        event.preventDefault();
        const first = Object.entries(problems).find(([, value]) => value);
        if (first) {
            setError({ message: first[1] });
            setStep(STEPS.findIndex((item) => item.key === first[0]));
            return;
        }
        setPending(true);
        setError(null);
        const body = {
            role: form.role,
            title: form.title.trim() || undefined,
            description: form.description.trim(),
            candidates: form.candidates,
            opensAt: form.opensNow ? null : opensAt,
            closesAt
        };
        try {
            const response = editId ? await electionApi.update(editId, body) : await electionApi.create({ club: clubId, ...body });
            toast.success(editId ? "Election updated" : response.data.status === "OPEN" ? "Voting is open — members have been notified" : "Election scheduled");
            navigate(`/clubs/${clubId}/elections/${response.data._id}`, { replace: true });
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    const review = [
        ["Role", role?.name, 0],
        ["Title", form.title.trim() || `${role?.name || ""} election`, 0],
        [
            "Candidates",
            form.candidates
                .map((candidate) => memberById.get(candidate.user)?.user.name)
                .filter(Boolean)
                .join(", "),
            1
        ],
        ["Voting opens", form.opensNow ? "Straight away" : opensAt ? formatDateTime(opensAt) : "", 2],
        ["Voting closes", closesAt ? formatDateTime(closesAt) : "", 2]
    ];

    return (
        <AsyncContent loading={loading} error={loadError}>
            <WizardHeader
                eyebrow={club?.name}
                title={editId ? "Edit election" : "Hold an election"}
                back={<PageHeader back={{ to: editId ? `/clubs/${clubId}/elections/${editId}` : `/clubs/${clubId}/elections`, label: "Elections" }} title="" />}
            />
            <form className="wiz stack-lg" onSubmit={submit} noValidate>
                <Stepper steps={STEPS} current={step} reached={editId ? STEPS.length - 1 : step} onStep={setStep} problems={stepProblems} />
                <ApiErrorAlert error={error} />

                {step === 0 && (
                    <FormSection
                        title="The role"
                        description="Which role members are choosing someone for — for example when a leader steps down or the academic year ends."
                    >
                        <div className="form-grid">
                            <Select
                                label="Role"
                                value={form.role}
                                onChange={(event) => set({ role: event.target.value })}
                                placeholder="Choose a role"
                                options={roles.map((item) => ({ value: item.key, label: item.name }))}
                                required
                            />
                            <Input
                                label="Title"
                                value={form.title}
                                onChange={(event) => set({ title: event.target.value })}
                                maxLength={120}
                                placeholder={`${role?.name || "President"} election 2026`}
                            />
                            <Textarea
                                className="span-2"
                                label="Note for members"
                                value={form.description}
                                onChange={(event) => set({ description: event.target.value })}
                                maxLength={1000}
                                rows={3}
                                placeholder="Why the election is being held and what the role involves"
                            />
                        </div>
                    </FormSection>
                )}

                {step === 1 && (
                    <FormSection
                        title="Candidates"
                        description={`Pick 2 to ${MAX_CANDIDATES} members who are standing. You can add a line about each one.`}
                        aside={
                            <span className="small subtle">
                                {form.candidates.length}/{MAX_CANDIDATES} chosen
                            </span>
                        }
                    >
                        <div className="stack">
                            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search members" />
                            <ul className="election-pick-list">
                                {shown.map((member) => {
                                    const isChosen = chosen(member.user._id);
                                    const candidate = form.candidates.find((item) => item.user === member.user._id);
                                    return (
                                        <li key={member.user._id} className={isChosen ? "is-chosen" : ""}>
                                            <button
                                                type="button"
                                                className="election-pick"
                                                aria-pressed={isChosen}
                                                onClick={() => toggleCandidate(member.user._id)}
                                            >
                                                <Avatar name={member.user.name} src={member.user.avatar} size="sm" />
                                                <span className="grow stack-xs">
                                                    <strong>{member.user.name}</strong>
                                                    <span className="small muted">{member.roleName}</span>
                                                </span>
                                                <span className="election-radio" aria-hidden="true">
                                                    {isChosen && <Check size={14} strokeWidth={3} />}
                                                </span>
                                            </button>
                                            {isChosen && (
                                                <Input
                                                    label={`About ${member.user.name.split(" ")[0]} (optional)`}
                                                    value={candidate.statement}
                                                    onChange={(event) => setStatement(member.user._id, event.target.value)}
                                                    maxLength={300}
                                                    placeholder="e.g. Ran the tech fest last year"
                                                />
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </FormSection>
                )}

                {step === 2 && (
                    <FormSection
                        title="Voting time"
                        description="Every member who is in the club when voting opens gets one secret vote. Counts stay hidden until it closes."
                    >
                        <div className="stack election-timing">
                            <Segmented
                                label="Voting opens"
                                options={[
                                    { value: "now", label: "Open now" },
                                    { value: "later", label: "Schedule" }
                                ]}
                                value={form.opensNow ? "now" : "later"}
                                onChange={(value) =>
                                    set({ opensNow: value === "now", opensAt: value === "later" && !form.opensAt ? later(Date.now(), 1) : form.opensAt })
                                }
                            />
                            {!form.opensNow && (
                                <Input
                                    type="datetime-local"
                                    label="Voting opens"
                                    value={form.opensAt}
                                    onChange={(event) => set({ opensAt: event.target.value })}
                                    required
                                />
                            )}
                            <Segmented
                                label="Voting stays open for"
                                options={DURATIONS}
                                value={form.duration}
                                onChange={(value) =>
                                    set({ duration: value, closesAt: value === "custom" && !form.closesAt ? later(opensAt || Date.now(), 3) : form.closesAt })
                                }
                            />
                            {form.duration === "custom" && (
                                <Input
                                    type="datetime-local"
                                    label="Voting closes"
                                    value={form.closesAt}
                                    onChange={(event) => set({ closesAt: event.target.value })}
                                    required
                                />
                            )}
                            {closesAt && <span className="small subtle">Voting closes {formatDateTime(closesAt)}.</span>}
                        </div>
                    </FormSection>
                )}

                {step === 3 && (
                    <FormSection title="Review" description="Members are notified when voting opens, and the election card appears in the club group.">
                        <dl className="review-list">
                            {review.map(([label, value, target]) => (
                                <div key={label} className={stepProblems[STEPS[target].key] ? "has-problem" : ""}>
                                    <dt>{label}</dt>
                                    <dd className="pre-line">{value || "—"}</dd>
                                    <Button variant="ghost" size="sm" onClick={() => setStep(target)} aria-label={`Change ${label.toLowerCase()}`}>
                                        Change
                                    </Button>
                                </div>
                            ))}
                        </dl>
                    </FormSection>
                )}

                <WizardNav
                    current={step}
                    total={STEPS.length}
                    onBack={() => setStep(step - 1)}
                    onNext={next}
                    final={
                        <>
                            <Button variant="secondary" onClick={() => navigate(-1)} disabled={pending}>
                                Cancel
                            </Button>
                            <Button type="submit" loading={pending}>
                                <Vote size={16} /> {editId ? "Save changes" : form.opensNow ? "Open voting" : "Schedule election"}
                            </Button>
                        </>
                    }
                />
            </form>
        </AsyncContent>
    );
};

export default ElectionFormPage;
