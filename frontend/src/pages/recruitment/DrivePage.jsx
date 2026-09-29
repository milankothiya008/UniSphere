import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Briefcase, ChevronDown, FileText, Inbox, Layers, Megaphone, Send, Users } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { Alert, AsyncContent, Avatar, Badge, ButtonLink, Card, Tabs } from "../../components/ui";
import { ApplicationBadge, Deadline, DriveStepper, PhaseBadge } from "../../components/recruitment/RecruitmentParts";
import { DriveActions } from "../../components/recruitment/DriveActions";
import { MyApplicationCard } from "../../components/recruitment/MyApplicationCard";
import { ApplicationsPanel } from "../../components/recruitment/ApplicationsPanel";
import { RoundsPanel } from "../../components/recruitment/RoundsPanel";
import { QuestionPreview } from "../../components/recruitment/QuestionPreview";
import { batchLabel, departmentsLabel, formatDateTime, plural } from "../../lib/format";

const coverStyle = (src) => (src ? { "--cover": `url("${String(src).replace(/"/g, "%22")}")` } : undefined);

// Where one role stands, for the club side.
const STAGES = {
    APPLICATIONS: ["Taking applications", "success"],
    CLOSED: ["Ready for selection", "info"],
    ROUNDS: ["Selection rounds", "violet"],
    FINALIZED: ["Offers sent", "ink"]
};

const RoleForm = ({ position }) => (
    <ol className="recruit-preview-pages is-compact">
        {position.form.pages.map((page, index) => (
            <li key={page._id}>
                <div className="recruit-preview-page-head">
                    <span className="recruit-step-dot">{index + 1}</span>
                    <div>
                        <strong>{page.title}</strong>
                        {page.description && <p className="subtle small">{page.description}</p>}
                    </div>
                </div>
                <div className="stack-sm">
                    {page.questions.map((question) => (
                        <QuestionPreview key={question._id} question={question} />
                    ))}
                </div>
            </li>
        ))}
    </ol>
);

/** One role in the drive: what it is, and what the viewer can do about it. */
const RoleCard = ({ drive, position, index, staff, mine }) => {
    const [showForm, setShowForm] = useState(false);
    const { viewer } = drive;
    const [stageLabel, stageTone] = STAGES[position.stage] || [];
    return (
        <article className={`recruit-role-card ${mine ? `is-${mine.status.toLowerCase()}` : ""}`} style={{ "--i": index }}>
            <div className="recruit-role-card-head">
                <div className="grow">
                    <h3>{position.title}</h3>
                    <div className="recruit-chips">
                        {position.openings ? <span className="recruit-chip">{plural(position.openings, "opening")}</span> : null}
                        <span className="recruit-chip">
                            {plural(position.form.pages.length, "page")} · {plural(position.questionCount, "question")}
                        </span>
                    </div>
                </div>
                {staff && stageLabel && (
                    <Badge tone={stageTone} dot>
                        {stageLabel}
                    </Badge>
                )}
                {!staff && mine && (mine.status === "WITHDRAWN" && mine.closedReason ? <Badge dot>Closed</Badge> : <ApplicationBadge status={mine.status} />)}
            </div>
            {position.description && <p className="subtle small recruit-role-card-desc">{position.description}</p>}

            {staff && position.counts && ["PUBLISHED", "COMPLETED", "CANCELLED"].includes(drive.status) && (
                <dl className="recruit-role-stats">
                    <div>
                        <dt>Applied</dt>
                        <dd>{position.counts.total}</dd>
                    </div>
                    <div>
                        <dt>In selection</dt>
                        <dd>{position.counts.active}</dd>
                    </div>
                    <div>
                        <dt>Offers</dt>
                        <dd>{position.counts.offered}</dd>
                    </div>
                    <div>
                        <dt>Joined</dt>
                        <dd>{position.counts.accepted}</dd>
                    </div>
                </dl>
            )}

            <div className="recruit-role-card-actions">
                {!staff && !mine && viewer.canApply && (
                    <ButtonLink to={`/recruitment/${drive._id}/apply/${position._id}`} variant="accent" size="sm">
                        <Send size={15} /> Apply for {position.title}
                    </ButtonLink>
                )}
                {!staff && mine && (
                    <a className="btn btn-secondary btn-sm" href={`#application-${mine._id}`}>
                        View your application
                    </a>
                )}
                {staff && position.form.pages.length > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showForm} onClick={() => setShowForm((value) => !value)}>
                        <ChevronDown size={15} className={showForm ? "is-flipped" : ""} /> {showForm ? "Hide form" : "View form"}
                    </button>
                )}
            </div>
            {showForm && <RoleForm position={position} />}
        </article>
    );
};

// The drive's story for everyone: the roles, who can apply, how it works.
const Overview = ({ drive, staff, mine }) => (
    <div className="stack-lg">
        <Card title="About this recruitment">
            <p className="prose">{drive.description}</p>
        </Card>
        <Card title={<h2 className="row" id="roles"><Briefcase size={18} /> Roles</h2>}>
            <div className="stack">
                {!staff && drive.positions.length > 1 && (
                    <p className="subtle small" style={{ margin: 0 }}>
                        Each role has its own application and selection. You can apply for more than one, but you'll join in only one role.
                    </p>
                )}
                <div className="recruit-role-cards">
                    {drive.positions.map((position, index) => (
                        <RoleCard key={position._id} drive={drive} position={position} index={index} staff={staff} mine={mine.find((application) => application.position === position._id)} />
                    ))}
                </div>
            </div>
        </Card>
        {!staff && (
            <Card title="How selection works">
                <ol className="recruit-howto">
                    <li>
                        <strong>Apply</strong> for a role before the deadline — the form goes page by page and takes a few minutes.
                    </li>
                    <li>
                        <strong>Selection rounds</strong> for each role — screening and interviews, online or on campus. You'll get an email with the time and place, and reminders.
                    </li>
                    <li>
                        <strong>Offer</strong> — if you're selected you get an offer to accept within a few days. Applied for several roles? You accept one, and the others close.
                    </li>
                </ol>
            </Card>
        )}
    </div>
);

// The role switcher on the Selection tab.
const RoleSwitcher = ({ positions, value, onChange }) => (
    <div className="recruit-role-tabs" role="tablist" aria-label="Choose a role">
        {positions.map((position) => {
            const [label] = STAGES[position.stage] || [""];
            return (
                <button key={position._id} type="button" role="tab" aria-selected={position._id === value} className={`recruit-role-tab ${position._id === value ? "is-active" : ""}`} onClick={() => onChange(position._id)}>
                    <span>{position.title}</span>
                    <span className="recruit-role-tab-meta">
                        {label}
                        {position.counts ? ` · ${position.counts.active} in selection` : ""}
                    </span>
                </button>
            );
        })}
    </div>
);

/** A recruitment drive: the student's way in, and the president's and mentor's workspace. */
const DrivePage = () => {
    const { id } = useParams();
    const { user, isStudent } = useAuth();
    const [params, setParams] = useSearchParams();
    const { data: drive, loading, error, reload, setData } = useApi(() => recruitmentApi.get(id), [id]);
    const viewer = drive?.viewer || {};
    const staff = viewer.canManage || viewer.isMentor;
    const applied = Boolean(viewer.applications?.length);
    const mine = useApi(() => recruitmentApi.myApplications(id), [id, viewer.applications?.length], { enabled: Boolean(isStudent && applied) });
    const tab = staff ? params.get("tab") || "overview" : "overview";
    const roleId = params.get("role") || drive?.positions[0]?._id;
    const selected = drive?.positions.find((position) => position._id === roleId) || drive?.positions[0];

    const refresh = () => {
        reload({ silent: true });
        if (applied) mine.reload({ silent: true });
    };
    const setParam = (name, value) => {
        params.set(name, value);
        setParams(params, { replace: true });
    };

    // From an offer email (?offer=1): bring the offer into view.
    const wantsOffer = params.get("offer") === "1";
    useEffect(() => {
        if (!wantsOffer || !mine.data) return;
        const offer = mine.data.find((application) => application.status === "OFFERED");
        if (offer) document.getElementById(`offer-${offer._id}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }, [wantsOffer, mine.data]);

    const tabs = [
        { value: "overview", label: "Overview", icon: Layers },
        ...(["PUBLISHED", "COMPLETED", "CANCELLED"].includes(drive?.status)
            ? [
                  { value: "applications", label: "Applications", icon: Inbox, count: drive?.counts?.total ?? null },
                  { value: "selection", label: "Selection", icon: Users }
              ]
            : [])
    ];
    const myApplications = mine.data || [];
    const offers = myApplications.filter((application) => application.status === "OFFERED");

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {drive && (
                <div className="stack-lg">
                    <section className={`hero recruit-hero ${drive.club.coverImage ? "hero-cover" : ""}`} style={coverStyle(drive.club.coverImage)}>
                        <div className="recruit-hero-inner">
                            <Link to={`/clubs/${drive.club._id}`} className="recruit-hero-club">
                                <Avatar name={drive.club.name} src={drive.club.logo} size="sm" square /> {drive.club.name}
                            </Link>
                            <div className="row" style={{ gap: 8 }}>
                                <span className="recruit-eyebrow">
                                    <Megaphone size={14} /> Recruitment
                                </span>
                                <PhaseBadge phase={drive.phase} />
                            </div>
                            <h1>{drive.title}</h1>
                            <div className="recruit-hero-meta">
                                {["UPCOMING", "OPEN", "CLOSED", "ROUNDS"].includes(drive.phase) && <Deadline drive={drive} />}
                                <span>
                                    <Users size={14} /> {departmentsLabel(drive.club)}
                                    {drive.eligibility?.batches?.length ? ` · batch ${drive.eligibility.batches.map(batchLabel).join(", ")}` : ""}
                                </span>
                                <span>
                                    <Briefcase size={14} /> {drive.positions.map((position) => position.title).join(" · ")}
                                </span>
                            </div>
                        </div>
                        {isStudent && !staff && (
                            <div className="recruit-hero-cta">
                                {offers.length ? (
                                    <a className="btn btn-accent btn-lg" href={`#offer-${offers[0]._id}`}>
                                        You have an offer — respond
                                    </a>
                                ) : viewer.canApply ? (
                                    drive.positions.length === 1 && !applied ? (
                                        <ButtonLink to={`/recruitment/${drive._id}/apply/${drive.positions[0]._id}`} variant="accent" size="lg">
                                            <Send size={17} /> Apply now
                                        </ButtonLink>
                                    ) : (
                                        <a className="btn btn-accent btn-lg" href="#roles">
                                            <Send size={17} /> {applied ? "Apply for another role" : "Choose a role"}
                                        </a>
                                    )
                                ) : (
                                    !applied && viewer.applyProblem && <span className="hero-note">{viewer.applyProblem}</span>
                                )}
                            </div>
                        )}
                    </section>

                    {staff && <DriveStepper phase={drive.phase} />}
                    {staff && drive.status === "NEEDS_CHANGES" && drive.reviewComment && (
                        <Alert type="warning" title="Your faculty mentor asked for changes">
                            {drive.reviewComment}
                        </Alert>
                    )}
                    {staff && drive.status === "REJECTED" && (
                        <Alert type="error" title="Not approved by the faculty mentor">
                            {drive.reviewComment}
                        </Alert>
                    )}
                    {staff && drive.status === "PENDING_APPROVAL" && !viewer.canReview && (
                        <Alert type="info" title="Waiting for your faculty mentor">
                            Sent {formatDateTime(drive.submittedAt)}. You'll be notified when it's reviewed.
                        </Alert>
                    )}
                    {staff && drive.status === "APPROVED" && (
                        <Alert type="success" title="Approved — ready to publish">
                            {drive.reviewComment ? `Mentor's note: "${drive.reviewComment}". ` : ""}Publishing notifies every student who can join.
                        </Alert>
                    )}
                    {drive.status === "CANCELLED" && (
                        <Alert type="error" title="This recruitment was cancelled">
                            {drive.cancellationReason || "The club cancelled this drive."}
                        </Alert>
                    )}

                    {staff && tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(value) => setParam("tab", value)} />}

                    <div className="detail-layout aside-first-mobile">
                        <div className="stack-lg">
                            {isStudent && !staff && myApplications.length > 0 && (
                                <section className="stack" aria-label="Your applications">
                                    {myApplications.map((application) => (
                                        <div key={application._id} id={`application-${application._id}`}>
                                            <MyApplicationCard drive={drive} application={application} others={myApplications.filter((other) => other._id !== application._id)} onChange={refresh} />
                                        </div>
                                    ))}
                                </section>
                            )}
                            {tab === "overview" && <Overview drive={drive} staff={staff} mine={myApplications} />}
                            {tab === "applications" && staff && <ApplicationsPanel drive={drive} />}
                            {tab === "selection" && staff && selected && (
                                <div className="stack-lg">
                                    {drive.positions.length > 1 && <RoleSwitcher positions={drive.positions} value={selected._id} onChange={(value) => setParam("role", value)} />}
                                    <RoundsPanel key={selected._id} drive={drive} position={selected} onDriveChange={() => reload({ silent: true })} />
                                </div>
                            )}
                        </div>
                        <aside className="stack">
                            <DriveActions drive={drive} onChange={(updated) => setData(updated)} />
                            {staff && drive.counts && (
                                <Card title="At a glance">
                                    <dl className="recruit-glance">
                                        <div>
                                            <dt>Applications</dt>
                                            <dd>{drive.counts.total}</dd>
                                        </div>
                                        <div>
                                            <dt>In selection</dt>
                                            <dd>{drive.counts.active}</dd>
                                        </div>
                                        <div>
                                            <dt>Offers out</dt>
                                            <dd>{drive.counts.offered}</dd>
                                        </div>
                                        <div>
                                            <dt>Joined</dt>
                                            <dd>{drive.counts.accepted}</dd>
                                        </div>
                                    </dl>
                                </Card>
                            )}
                            {!user && (
                                <Card>
                                    <p className="small" style={{ margin: 0 }}>
                                        <FileText size={14} /> <Link to="/login">Sign in</Link> to apply.
                                    </p>
                                </Card>
                            )}
                        </aside>
                    </div>
                </div>
            )}
        </AsyncContent>
    );
};

export default DrivePage;
