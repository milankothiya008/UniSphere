import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
    CalendarClock,
    Check,
    CheckCircle2,
    Clock,
    Code2,
    ExternalLink,
    FileBadge,
    Gavel,
    GitBranch,
    Lightbulb,
    ListChecks,
    Pencil,
    Plus,
    Presentation,
    Rocket,
    Save,
    Send,
    Settings2,
    Trash2,
    Trophy,
    UserMinus,
    Users,
    Video
} from "lucide-react";
import { eventApi, hackathonApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, AsyncContent, Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Tabs, Textarea, UserPicker } from "../../components/ui";
import { countdownParts, formatDateTime, fromDateTimeInput, formatEventDates, timeAgo, toDateTimeInput } from "../../lib/format";

// ---------------------------------------------------------------- shared bits

const useNow = (every = 30000) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), every);
        return () => clearInterval(timer);
    }, [every]);
    return now;
};

const Countdown = ({ to, label }) => {
    const now = useNow(1000);
    const left = new Date(to) - now;
    if (left <= 0) return null;
    return (
        <div className={`hack-countdown ${left < 3600000 ? "is-urgent" : ""}`}>
            <Clock size={16} />
            <span>
                {label} in <strong>{countdownParts(left).filter(([value], index, all) => value > 0 || index === all.length - 1).map(([value, unit]) => `${value} ${unit}`).join(" ")}</strong>
            </span>
            <span className="subtle small">{formatDateTime(to)}</span>
        </div>
    );
};

const nextDeadline = (hack) => {
    const now = Date.now();
    if (new Date(hack.revealAt) > now) return [hack.revealAt, "Problem statements are released"];
    if (new Date(hack.selectionDeadline) > now) return [hack.selectionDeadline, "Problem selection closes"];
    if (new Date(hack.submissionDeadline) > now) return [hack.submissionDeadline, "Submissions close"];
    return null;
};

const LinkChip = ({ href, icon: Icon, label }) =>
    href ? (
        <a className="hack-link" href={href} target="_blank" rel="noreferrer">
            <Icon size={14} /> {label} <ExternalLink size={11} />
        </a>
    ) : null;

const ProjectLinks = ({ project }) => (
    <div className="hack-links">
        <LinkChip href={project.repoUrl} icon={GitBranch} label="Code" />
        <LinkChip href={project.demoUrl} icon={Rocket} label="Demo" />
        <LinkChip href={project.videoUrl} icon={Video} label="Video" />
        <LinkChip href={project.deckUrl} icon={Presentation} label="Slides" />
    </div>
);

// ---------------------------------------------------------------- Overview (participants and everyone)

const Agenda = ({ agenda }) => {
    const now = useNow();
    if (!agenda.length) return null;
    const currentIndex = agenda.reduce((found, item, index) => (new Date(item.startsAt) <= now ? index : found), -1);
    return (
        <Card
            title={
                <h2 className="row">
                    <CalendarClock size={18} /> Agenda
                </h2>
            }
        >
            <ol className="hack-agenda">
                {agenda.map((item, index) => (
                    <li key={item._id} className={index < currentIndex ? "is-past" : index === currentIndex ? "is-now" : ""}>
                        <span className="hack-agenda-time">{formatDateTime(item.startsAt)}</span>
                        <span className="hack-agenda-body">
                            <strong>
                                {item.title}
                                {index === currentIndex && <Badge tone="success">Now</Badge>}
                            </strong>
                            {item.note && <span className="subtle small">{item.note}</span>}
                        </span>
                    </li>
                ))}
            </ol>
        </Card>
    );
};

const SubmissionForm = ({ hack, eventId, onSaved }) => {
    const toast = useToast();
    const existing = hack.myEntry?.project || {};
    const [form, setForm] = useState({ title: "", summary: "", repoUrl: "", demoUrl: "", videoUrl: "", deckUrl: "", techStack: "", ...existing });
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

    const save = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            const response = await hackathonApi.submitProject(eventId, form);
            onSaved(response.data);
            toast.success(hack.myEntry?.submittedAt ? "Submission updated" : "Project submitted — good luck!");
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <form className="stack" onSubmit={save}>
            <div className="form-grid">
                <Input label="Project name" value={form.title} onChange={set("title")} maxLength={120} required />
                <Input label="Tech stack" value={form.techStack} onChange={set("techStack")} maxLength={300} placeholder="React, Node.js, MongoDB" />
                <Textarea className="span-2" label="What did you build?" value={form.summary} onChange={set("summary")} rows={4} maxLength={3000} required hint="The problem, your solution and how it works (at least 20 characters)" />
                <Input label="Code repository" type="url" value={form.repoUrl} onChange={set("repoUrl")} placeholder="https://github.com/team/project" />
                <Input label="Live demo" type="url" value={form.demoUrl} onChange={set("demoUrl")} placeholder="https://…" />
                <Input label="Demo video" type="url" value={form.videoUrl} onChange={set("videoUrl")} placeholder="YouTube or Drive link" />
                <Input label="Presentation" type="url" value={form.deckUrl} onChange={set("deckUrl")} placeholder="Slides or PDF link" />
            </div>
            <span className="subtle small">Add at least a code repository or a live demo. You can edit your submission until the deadline.</span>
            <ApiErrorAlert error={error} />
            <div className="form-actions">
                <Button type="submit" loading={pending}>
                    <Send size={16} /> {hack.myEntry?.submittedAt ? "Update submission" : "Submit project"}
                </Button>
            </div>
        </form>
    );
};

const TeamCard = ({ hack, eventId, onChange }) => {
    const entry = hack.myEntry;
    const viewer = hack.viewer;
    const [editing, setEditing] = useState(false);
    const submissionOpen = viewer.canSubmit && (!hack.problemCount || entry.problemStatement);
    return (
        <Card
            className="hack-team"
            title={
                <h2 className="row">
                    <Users size={18} /> {entry.name}
                </h2>
            }
            actions={entry.members > 1 ? <span className="subtle small">{entry.members} members</span> : null}
        >
            <div className="stack">
                <div className="hack-team-steps">
                    <div className={`hack-team-step ${entry.problemStatement ? "is-done" : ""}`}>
                        {entry.problemStatement ? <CheckCircle2 size={18} /> : <Lightbulb size={18} />}
                        <span>
                            <strong>Problem statement</strong>
                            <span className="small">{entry.problemStatement ? entry.problemStatement.title : new Date(hack.revealAt) > Date.now() ? `Released ${formatDateTime(hack.revealAt)}` : "Not chosen yet — pick one below"}</span>
                        </span>
                    </div>
                    <div className={`hack-team-step ${entry.submittedAt ? "is-done" : ""}`}>
                        {entry.submittedAt ? <CheckCircle2 size={18} /> : <Rocket size={18} />}
                        <span>
                            <strong>Project</strong>
                            <span className="small">{entry.submittedAt ? `“${entry.project.title}” · submitted ${timeAgo(entry.submittedAt)}` : `Due ${formatDateTime(hack.submissionDeadline)}`}</span>
                        </span>
                    </div>
                </div>
                {entry.submittedAt && !editing && (
                    <div className="hack-submitted">
                        <p className="small" style={{ margin: 0 }}>
                            {entry.project.summary}
                        </p>
                        <ProjectLinks project={entry.project} />
                        {submissionOpen && (
                            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                                <Pencil size={14} /> Edit submission
                            </Button>
                        )}
                    </div>
                )}
                {submissionOpen && (!entry.submittedAt || editing) && (
                    <SubmissionForm
                        hack={hack}
                        eventId={eventId}
                        onSaved={(data) => {
                            setEditing(false);
                            onChange(data);
                        }}
                    />
                )}
                {!viewer.canSubmit && !entry.submittedAt && new Date(hack.submissionDeadline) <= Date.now() && <p className="subtle small">The submission deadline has passed.</p>}
            </div>
        </Card>
    );
};

const Problems = ({ hack, eventId, onChange }) => {
    const toast = useToast();
    const [choosing, setChoosing] = useState(null);
    const choose = async (problem) => {
        setChoosing(problem._id);
        try {
            const response = await hackathonApi.chooseProblem(eventId, problem._id);
            onChange(response.data);
            toast.success(`Your team is working on “${problem.title}”`);
        } catch (error) {
            toast.error(error);
        } finally {
            setChoosing(null);
        }
    };

    if (!hack.problemStatements.length) {
        if (!hack.problemCount) return null;
        return (
            <Card>
                <EmptyState
                    icon={Lightbulb}
                    title={`${hack.problemCount} problem statement${hack.problemCount === 1 ? "" : "s"} waiting`}
                    description={`They're released ${formatDateTime(hack.revealAt)}${hack.viewer.isParticipant ? ". Your team then picks one before the selection deadline." : " to registered teams."}`}
                />
            </Card>
        );
    }
    const mine = hack.myEntry?.problemStatement?._id;
    return (
        <Card
            title={
                <h2 className="row">
                    <Lightbulb size={18} /> Problem statements
                </h2>
            }
            actions={hack.viewer.canChooseProblem ? <span className="subtle small">Choose by {formatDateTime(hack.selectionDeadline)}</span> : null}
        >
            <div className="hack-problems">
                {hack.problemStatements.map((problem, index) => {
                    const full = problem.maxTeams && problem.teams >= problem.maxTeams && mine !== problem._id;
                    return (
                        <article key={problem._id} className={`hack-problem ${mine === problem._id ? "is-mine" : ""}`} style={{ "--i": Math.min(index, 10) }}>
                            <header>
                                <span className="hack-problem-no">PS{String(index + 1).padStart(2, "0")}</span>
                                {problem.track && <Badge tone="info">{problem.track}</Badge>}
                                <span className="subtle small">
                                    {problem.teams} team{problem.teams === 1 ? "" : "s"}
                                    {problem.maxTeams ? ` of ${problem.maxTeams}` : ""}
                                </span>
                            </header>
                            <strong>{problem.title}</strong>
                            <p className="small pre-line">{problem.description}</p>
                            {mine === problem._id ? (
                                <span className="hack-chosen">
                                    <Check size={15} /> Your team's problem
                                </span>
                            ) : (
                                hack.viewer.canChooseProblem && (
                                    <Button size="sm" variant={mine ? "secondary" : "primary"} onClick={() => choose(problem)} loading={choosing === problem._id} disabled={full}>
                                        {full ? "Full" : mine ? "Switch to this" : "Choose this problem"}
                                    </Button>
                                )
                            )}
                        </article>
                    );
                })}
            </div>
        </Card>
    );
};

const Overview = ({ hack, event, setHack }) => {
    const next = nextDeadline(hack);
    return (
        <div className="stack-lg">
            {next && <Countdown to={next[0]} label={next[1]} />}
            {hack.viewer.isParticipant && <TeamCard hack={hack} eventId={event._id} onChange={setHack} />}
            {!hack.viewer.isParticipant && !hack.viewer.canManage && !hack.viewer.canJudge && (
                <Card>
                    <p className="subtle" style={{ margin: 0 }}>
                        Problem statements and submissions are for registered teams. <Link to={`/events/${event._id}`}>Register on the event page</Link> while registration is open.
                    </p>
                </Card>
            )}
            <Problems hack={hack} eventId={event._id} onChange={setHack} />
            <Agenda agenda={hack.agenda} />
            <Card
                title={
                    <h2 className="row">
                        <ListChecks size={18} /> How projects are judged
                    </h2>
                }
            >
                <ul className="hack-criteria">
                    {hack.criteria.map((criterion) => (
                        <li key={criterion._id}>
                            <span>{criterion.name}</span>
                            <strong>{criterion.maxScore}</strong>
                        </li>
                    ))}
                    <li className="is-total">
                        <span>Total</span>
                        <strong>{hack.maxTotal}</strong>
                    </li>
                </ul>
                <p className="subtle small" style={{ margin: "8px 0 0" }}>
                    {hack.judgeCount} judge{hack.judgeCount === 1 ? "" : "s"} score every project; the ranking uses the average of their totals.
                </p>
            </Card>
        </div>
    );
};

// ---------------------------------------------------------------- Setup (organisers)

const ProblemEditor = ({ eventId, problem, onClose, onSaved }) => {
    const creating = problem === "new";
    const [form, setForm] = useState(creating ? { title: "", description: "", track: "", maxTeams: "" } : { ...problem, maxTeams: problem.maxTeams ?? "" });
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
    const save = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const body = { title: form.title, description: form.description, track: form.track, maxTeams: form.maxTeams === "" ? null : Number(form.maxTeams) };
        try {
            const response = creating ? await hackathonApi.addProblem(eventId, body) : await hackathonApi.updateProblem(eventId, problem._id, body);
            onSaved(response.data);
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };
    return (
        <Modal
            open
            onClose={pending ? undefined : onClose}
            size="lg"
            title={creating ? "New problem statement" : "Edit problem statement"}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form="problem-form" loading={pending}>
                        <Save size={16} /> Save
                    </Button>
                </>
            }
        >
            <form id="problem-form" className="form-grid" onSubmit={save}>
                <Input className="span-2" label="Title" value={form.title} onChange={set("title")} maxLength={160} required />
                <Textarea className="span-2" label="Problem description" value={form.description} onChange={set("description")} rows={7} maxLength={4000} required hint="The challenge, who it's for, and what a good solution should do" />
                <Input label="Track (optional)" value={form.track} onChange={set("track")} maxLength={60} placeholder="e.g. Health, FinTech" />
                <Input label="Max teams (optional)" type="number" min={1} value={form.maxTeams} onChange={set("maxTeams")} hint="Empty for no limit" />
                <div className="span-2">
                    <ApiErrorAlert error={error} />
                </div>
            </form>
        </Modal>
    );
};

const Setup = ({ hack, event, setHack }) => {
    const toast = useToast();
    const [times, setTimes] = useState({ revealAt: toDateTimeInput(hack.revealAt), selectionDeadline: toDateTimeInput(hack.selectionDeadline), submissionDeadline: toDateTimeInput(hack.submissionDeadline) });
    const [agenda, setAgenda] = useState(hack.agenda.map((item) => ({ ...item, startsAt: toDateTimeInput(item.startsAt) })));
    const [criteria, setCriteria] = useState(hack.criteria.map((item) => ({ ...item })));
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [saving, setSaving] = useState(null);
    const [error, setError] = useState(null);

    const save = async (what, body) => {
        setSaving(what);
        setError(null);
        try {
            const response = await hackathonApi.update(event._id, body);
            setHack(response.data);
            toast.success("Saved");
        } catch (err) {
            setError(err);
        } finally {
            setSaving(null);
        }
    };

    const startInput = toDateTimeInput(event.startAt);
    const endInput = toDateTimeInput(event.endAt);
    const setTime = (field) => (e) => setTimes((prev) => ({ ...prev, [field]: e.target.value }));

    return (
        <div className="stack-lg">
            <ApiErrorAlert error={error} />
            <Card
                title={
                    <h2 className="row">
                        <Clock size={18} /> Deadlines
                    </h2>
                }
            >
                <div className="form-grid">
                    <Input label="Release problem statements" type="datetime-local" min={startInput} max={endInput} value={times.revealAt} onChange={setTime("revealAt")} hint="Not before the event starts" />
                    <Input label="Problem selection closes" type="datetime-local" min={times.revealAt} max={endInput} value={times.selectionDeadline} onChange={setTime("selectionDeadline")} />
                    <Input label="Submissions close" type="datetime-local" min={times.selectionDeadline} max={endInput} value={times.submissionDeadline} onChange={setTime("submissionDeadline")} hint="Judging opens then" />
                </div>
                <div className="form-actions">
                    <Button
                        loading={saving === "times"}
                        onClick={() =>
                            save("times", {
                                revealAt: fromDateTimeInput(times.revealAt),
                                selectionDeadline: fromDateTimeInput(times.selectionDeadline),
                                submissionDeadline: fromDateTimeInput(times.submissionDeadline)
                            })
                        }
                    >
                        <Save size={16} /> Save deadlines
                    </Button>
                </div>
            </Card>

            <Card
                title={
                    <h2 className="row">
                        <Lightbulb size={18} /> Problem statements
                    </h2>
                }
                actions={
                    <Button size="sm" onClick={() => setEditing("new")}>
                        <Plus size={14} /> Add
                    </Button>
                }
            >
                {hack.problemStatements.length ? (
                    <ul className="hack-setup-list">
                        {hack.problemStatements.map((problem, index) => (
                            <li key={problem._id}>
                                <span className="hack-problem-no">PS{String(index + 1).padStart(2, "0")}</span>
                                <span className="grow">
                                    <strong>{problem.title}</strong>
                                    <span className="subtle small">
                                        {[problem.track, `${problem.teams} team${problem.teams === 1 ? "" : "s"}`, problem.maxTeams ? `max ${problem.maxTeams}` : null].filter(Boolean).join(" · ")}
                                    </span>
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => setEditing(problem)} aria-label={`Edit ${problem.title}`}>
                                    <Pencil size={14} />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleting(problem)} aria-label={`Remove ${problem.title}`} disabled={problem.teams > 0}>
                                    <Trash2 size={14} />
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState icon={Lightbulb} title="No problem statements yet" description="Add them any time — teams only see them once they're released." />
                )}
            </Card>

            <Card
                title={
                    <h2 className="row">
                        <CalendarClock size={18} /> Agenda
                    </h2>
                }
                actions={
                    <Button size="sm" variant="secondary" onClick={() => setAgenda((prev) => [...prev, { title: "", startsAt: prev.at(-1)?.startsAt || startInput, note: "" }])}>
                        <Plus size={14} /> Add item
                    </Button>
                }
            >
                <div className="stack">
                    {agenda.map((item, index) => (
                        <div key={item._id || `new-${index}`} className="hack-agenda-edit">
                            <Input label="When" type="datetime-local" value={item.startsAt} onChange={(e) => setAgenda((prev) => prev.map((row, i) => (i === index ? { ...row, startsAt: e.target.value } : row)))} />
                            <Input label="What" value={item.title} maxLength={120} placeholder="e.g. Mentoring round" onChange={(e) => setAgenda((prev) => prev.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)))} />
                            <Input label="Note" value={item.note} maxLength={300} onChange={(e) => setAgenda((prev) => prev.map((row, i) => (i === index ? { ...row, note: e.target.value } : row)))} />
                            <Button variant="ghost" size="sm" onClick={() => setAgenda((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove agenda item">
                                <Trash2 size={14} />
                            </Button>
                        </div>
                    ))}
                    {!agenda.length && <p className="subtle small">Opening ceremony, coding time, mentoring rounds, demos, results… teams see it on the hub.</p>}
                    <div className="form-actions">
                        <Button loading={saving === "agenda"} onClick={() => save("agenda", { agenda: agenda.map((item) => ({ ...item, startsAt: fromDateTimeInput(item.startsAt) })) })}>
                            <Save size={16} /> Save agenda
                        </Button>
                    </div>
                </div>
            </Card>

            <Card
                title={
                    <h2 className="row">
                        <ListChecks size={18} /> Judging criteria
                    </h2>
                }
            >
                <div className="stack">
                    {criteria.map((criterion, index) => (
                        <div key={criterion._id || `c-${index}`} className="hack-criterion-edit">
                            <Input label="Criterion" value={criterion.name} maxLength={60} onChange={(e) => setCriteria((prev) => prev.map((row, i) => (i === index ? { ...row, name: e.target.value } : row)))} />
                            <Input label="Max score" type="number" min={1} max={100} value={criterion.maxScore} onChange={(e) => setCriteria((prev) => prev.map((row, i) => (i === index ? { ...row, maxScore: e.target.value } : row)))} />
                            <Button variant="ghost" size="sm" onClick={() => setCriteria((prev) => prev.filter((_, i) => i !== index))} disabled={criteria.length <= 1} aria-label="Remove criterion">
                                <Trash2 size={14} />
                            </Button>
                        </div>
                    ))}
                    <div className="form-actions">
                        <Button variant="secondary" onClick={() => setCriteria((prev) => [...prev, { name: "", maxScore: 10 }])} disabled={criteria.length >= 10}>
                            <Plus size={14} /> Add criterion
                        </Button>
                        <Button loading={saving === "criteria"} onClick={() => save("criteria", { criteria: criteria.map((item) => ({ ...item, maxScore: Number(item.maxScore) })) })}>
                            <Save size={16} /> Save criteria
                        </Button>
                    </div>
                    <span className="subtle small">Criteria lock once judges start scoring.</span>
                </div>
            </Card>

            {editing && <ProblemEditor eventId={event._id} problem={editing} onClose={() => setEditing(null)} onSaved={setHack} />}
            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                onConfirm={async () => setHack((await hackathonApi.deleteProblem(event._id, deleting._id)).data)}
                title={`Remove “${deleting?.title}”?`}
                description="Teams haven't chosen it yet, so it can be removed."
                confirmLabel="Remove"
                variant="danger"
            />
        </div>
    );
};

const Judges = ({ hack, event, setHack }) => {
    const toast = useToast();
    const [removing, setRemoving] = useState(null);
    const add = async (user) => {
        try {
            setHack((await hackathonApi.addJudge(event._id, user._id)).data);
            toast.success(`${user.name} is a judge — they've been notified`);
        } catch (error) {
            toast.error(error);
        }
    };
    return (
        <Card
            title={
                <h2 className="row">
                    <Gavel size={18} /> Judges
                </h2>
            }
            actions={
                <div style={{ width: 300, maxWidth: "100%" }}>
                    <UserPicker placeholder="Add a faculty member or student" onSelect={add} exclude={hack.judges.map((judge) => judge._id)} />
                </div>
            }
        >
            <div className="stack">
                <p className="subtle small" style={{ margin: 0 }}>
                    Judges can be faculty or students who aren't taking part. They score every project once submissions close.
                </p>
                {hack.judges.length ? (
                    <ul className="hack-judges">
                        {hack.judges.map((judge) => (
                            <li key={judge._id}>
                                <Avatar name={judge.name} src={judge.avatar} size="sm" />
                                <Link to={`/people/${judge._id}`} className="grow">
                                    <strong>{judge.name}</strong>
                                    <span className="subtle small">
                                        {judge.accountType === "FACULTY" ? "Faculty" : "Student"}
                                        {judge.departmentCode ? ` · ${judge.departmentCode}` : ""}
                                    </span>
                                </Link>
                                <Button variant="ghost" size="sm" onClick={() => setRemoving(judge)} aria-label={`Remove ${judge.name}`}>
                                    <UserMinus size={15} />
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState icon={Gavel} title="No judges yet" />
                )}
            </div>
            <ConfirmDialog
                open={Boolean(removing)}
                onClose={() => setRemoving(null)}
                onConfirm={async () => setHack((await hackathonApi.removeJudge(event._id, removing._id)).data)}
                title={`Remove ${removing?.name} from the panel?`}
                description="Judges who have already scored projects stay on the panel."
                confirmLabel="Remove judge"
                variant="danger"
            />
        </Card>
    );
};

// ---------------------------------------------------------------- Judging (judges)

const ScoreCard = ({ entry, criteria, maxTotal, eventId, onSaved, index }) => {
    const toast = useToast();
    const initial = useMemo(() => Object.fromEntries(criteria.map((criterion) => [criterion._id, entry.myScore?.marks.find((mark) => mark.criterion === criterion._id)?.score ?? ""])), [criteria, entry.myScore]);
    const [marks, setMarks] = useState(initial);
    const [comment, setComment] = useState(entry.myScore?.comment || "");
    const [pending, setPending] = useState(false);
    const total = criteria.reduce((sum, criterion) => sum + (Number(marks[criterion._id]) || 0), 0);
    const complete = criteria.every((criterion) => marks[criterion._id] !== "" && Number(marks[criterion._id]) >= 0 && Number(marks[criterion._id]) <= criterion.maxScore);

    const save = async () => {
        setPending(true);
        try {
            const response = await hackathonApi.score(eventId, entry._id, { marks: criteria.map((criterion) => ({ criterion: criterion._id, score: Number(marks[criterion._id]) })), comment });
            onSaved(response.data);
            toast.success(`Score saved for ${entry.name}`);
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    return (
        <article className={`judge-card ${entry.myScore ? "is-scored" : ""}`} style={{ "--i": Math.min(index, 10) }}>
            <header>
                <span>
                    <strong>{entry.project.title}</strong>
                    <span className="subtle small">
                        {entry.name}
                        {entry.problemStatement ? ` · ${entry.problemStatement.title}` : ""}
                    </span>
                </span>
                {entry.myScore ? <Badge tone="success">Scored {entry.myScore.total}</Badge> : <Badge>To score</Badge>}
            </header>
            <p className="small pre-line">{entry.project.summary}</p>
            {entry.project.techStack && (
                <p className="small subtle" style={{ margin: 0 }}>
                    <Code2 size={12} /> {entry.project.techStack}
                </p>
            )}
            <ProjectLinks project={entry.project} />
            <div className="judge-marks">
                {criteria.map((criterion) => (
                    <label key={criterion._id} className="judge-mark">
                        <span className="small">{criterion.name}</span>
                        <span className="judge-mark-input">
                            <input
                                type="number"
                                className="input"
                                min={0}
                                max={criterion.maxScore}
                                step="0.5"
                                value={marks[criterion._id]}
                                onChange={(e) => setMarks((prev) => ({ ...prev, [criterion._id]: e.target.value }))}
                                aria-label={`${criterion.name} for ${entry.name}`}
                            />
                            <span className="subtle small">/ {criterion.maxScore}</span>
                        </span>
                    </label>
                ))}
            </div>
            <Textarea label="Comment for the organisers (optional)" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} />
            <div className="judge-footer">
                <span className="judge-total">
                    Total <strong>{total}</strong> / {maxTotal}
                </span>
                <Button onClick={save} loading={pending} disabled={!complete}>
                    <Save size={15} /> {entry.myScore ? "Update score" : "Save score"}
                </Button>
            </div>
        </article>
    );
};

const Judging = ({ event }) => {
    const { data, loading, error, reload, setData } = useApi(() => hackathonApi.judging(event._id), [event._id]);
    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {data &&
                (!data.open ? (
                    <Card>
                        <EmptyState icon={Gavel} title="Judging hasn't opened yet" description={`Projects are due ${formatDateTime(data.opensAt)}. You'll be notified when they're ready to score.`} />
                    </Card>
                ) : (
                    <div className="stack-lg">
                        <div className="judge-progress">
                            <strong>
                                {data.scored} of {data.entries.length}
                            </strong>{" "}
                            projects scored
                            <span className="judge-progress-bar">
                                <span style={{ width: `${data.entries.length ? (data.scored / data.entries.length) * 100 : 0}%` }} />
                            </span>
                        </div>
                        {data.entries.length ? (
                            <div className="judge-grid">
                                {data.entries.map((entry, index) => (
                                    <ScoreCard key={entry._id} index={index} entry={entry} criteria={data.criteria} maxTotal={data.maxTotal} eventId={event._id} onSaved={setData} />
                                ))}
                            </div>
                        ) : (
                            <Card>
                                <EmptyState icon={Gavel} title="No projects were submitted" />
                            </Card>
                        )}
                    </div>
                ))}
        </AsyncContent>
    );
};

// ---------------------------------------------------------------- Leaderboard (organisers, mentor)

const Leaderboard = ({ hack, event }) => {
    const toast = useToast();
    const { data, loading, error, reload, setData } = useApi(() => hackathonApi.leaderboard(event._id), [event._id]);
    const [winners, setWinners] = useState(3);
    const [pending, setPending] = useState(false);
    const [open, setOpen] = useState(null);

    const draft = async () => {
        setPending(true);
        try {
            const response = await hackathonApi.draftResults(event._id, { winners: Number(winners) });
            setData(response.data);
            toast.success(response.message);
        } catch (err) {
            toast.error(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {data && (
                <div className="stack-lg">
                    <div className="hack-stats">
                        {[
                            ["Teams", data.stats.entries],
                            ["Chose a problem", data.stats.chosen],
                            ["Submitted", data.stats.submitted],
                            ["Fully judged", data.stats.fullyScored]
                        ].map(([label, value]) => (
                            <div key={label} className="hack-stat">
                                <strong>{value}</strong>
                                <span className="subtle small">{label}</span>
                            </div>
                        ))}
                    </div>
                    <Card
                        title={
                            <h2 className="row">
                                <Trophy size={18} color="var(--gold-600)" /> Leaderboard
                            </h2>
                        }
                        padded={false}
                    >
                        {data.rows.length ? (
                            <ol className="board">
                                {data.rows.map((row) => (
                                    <li key={row._id} className={`board-row ${row.rank && row.rank <= 3 ? `is-top is-${row.rank}` : ""}`}>
                                        <button type="button" className="board-main" onClick={() => setOpen(open === row._id ? null : row._id)} aria-expanded={open === row._id}>
                                            <span className="board-rank">{row.rank ?? "—"}</span>
                                            <span className="board-who">
                                                <strong>{row.name}</strong>
                                                <span className="subtle small">
                                                    {row.project.title}
                                                    {row.problemStatement ? ` · ${row.problemStatement.title}` : ""}
                                                </span>
                                            </span>
                                            <span className="board-score">
                                                <strong>{row.average ?? "—"}</strong>
                                                <span className="subtle small">
                                                    / {data.maxTotal} · {row.judges}/{data.judgeCount} judges
                                                </span>
                                            </span>
                                            <span className="board-bar" aria-hidden="true">
                                                <span style={{ width: `${row.percent ?? 0}%` }} />
                                            </span>
                                        </button>
                                        {open === row._id && (
                                            <div className="board-detail">
                                                <ul className="hack-criteria">
                                                    {data.criteria.map((criterion) => (
                                                        <li key={criterion._id}>
                                                            <span>{criterion.name}</span>
                                                            <strong>
                                                                {row.byCriterion.find((item) => item.criterion === criterion._id)?.average ?? "—"} / {criterion.maxScore}
                                                            </strong>
                                                        </li>
                                                    ))}
                                                </ul>
                                                <ProjectLinks project={row.project} />
                                                {row.comments.map((item, index) => (
                                                    <p key={index} className="small board-comment">
                                                        <strong>{item.judge}:</strong> {item.comment}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <EmptyState icon={Trophy} title={data.stats.submitted ? "Waiting for the judges" : "No submissions yet"} />
                        )}
                    </Card>
                    {hack.viewer.canDraftResults && data.judgingOpen && data.rows.some((row) => row.rank) && (
                        <Card
                            title={
                                <h2 className="row">
                                    <FileBadge size={18} /> Results
                                </h2>
                            }
                        >
                            <div className="stack">
                                <p className="small" style={{ margin: 0 }}>
                                    Turn the leaderboard into the event's results: awards for the top teams and a “Judging” round with every score. The president reviews and publishes it from
                                    the results page.
                                </p>
                                <div className="row">
                                    <Input label="Winners" type="number" min={1} max={10} value={winners} onChange={(e) => setWinners(e.target.value)} style={{ width: 100 }} />
                                    <Button onClick={draft} loading={pending} style={{ alignSelf: "flex-end" }}>
                                        <Trophy size={16} /> {data.resultsDraftedAt ? "Update results draft" : "Prepare results"}
                                    </Button>
                                    {data.resultsDraftedAt && (
                                        <Link to={`/events/${event._id}/results/edit`} className="btn btn-secondary" style={{ alignSelf: "flex-end" }}>
                                            Open results
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </Card>
                    )}
                </div>
            )}
        </AsyncContent>
    );
};

// ---------------------------------------------------------------- Page

/**
 * The Hackathon hub (/events/:id/hackathon): teams pick a problem and submit here, organisers set it up,
 * judges score, and the organisers and mentor follow the leaderboard.
 */
const HackathonPage = () => {
    const { id } = useParams();
    const event = useApi(() => eventApi.get(id), [id]);
    const hackathon = useApi(() => hackathonApi.get(id), [id]);
    const [filters, setFilters] = useQueryState({ tab: "overview" });
    const hack = hackathon.data;

    if (event.error || hackathon.error) {
        return <ErrorState error={event.error || hackathon.error} onRetry={() => (event.error ? event.reload() : hackathon.reload())} />;
    }

    const viewer = hack?.viewer || {};
    const tabs = [
        { value: "overview", label: "Overview", icon: Lightbulb },
        viewer.canManage && { value: "setup", label: "Setup", icon: Settings2 },
        viewer.canManage && { value: "judges", label: `Judges${hack ? ` · ${hack.judgeCount}` : ""}`, icon: Gavel },
        viewer.canJudge && { value: "judging", label: "Judging", icon: ListChecks },
        viewer.canSeeLeaderboard && { value: "leaderboard", label: "Leaderboard", icon: Trophy }
    ].filter(Boolean);
    const tab = tabs.some((item) => item.value === filters.tab) ? filters.tab : "overview";
    const setHack = (data) => hackathon.setData(data);

    return (
        <AsyncContent loading={event.loading || hackathon.loading}>
            {event.data && hack && (
                <div className="hack-page">
                    <PageHeader
                        back={{ to: `/events/${id}`, label: "Back to event" }}
                        club={event.data.club}
                        title={event.data.title}
                        meta={`${formatEventDates(event.data.startAt, event.data.endAt)} · Hackathon`}
                    />
                    <div className="stack-lg">
                        {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(value) => setFilters({ tab: value === "overview" ? "" : value })} />}
                        {tab === "overview" && <Overview hack={hack} event={event.data} setHack={setHack} />}
                        {tab === "setup" && <Setup hack={hack} event={event.data} setHack={setHack} />}
                        {tab === "judges" && <Judges hack={hack} event={event.data} setHack={setHack} />}
                        {tab === "judging" && <Judging event={event.data} />}
                        {tab === "leaderboard" && <Leaderboard hack={hack} event={event.data} />}
                    </div>
                </div>
            )}
        </AsyncContent>
    );
};

export default HackathonPage;
