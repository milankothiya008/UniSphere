import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Briefcase, FileText, Inbox, Layers, Megaphone, Send, Users } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { Alert, AsyncContent, Avatar, ButtonLink, Card, Tabs } from "../../components/ui";
import { Deadline, DriveStepper, PhaseBadge } from "../../components/recruitment/RecruitmentParts";
import { DriveActions } from "../../components/recruitment/DriveActions";
import { MyApplicationCard } from "../../components/recruitment/MyApplicationCard";
import { ApplicationsPanel } from "../../components/recruitment/ApplicationsPanel";
import { RoundsPanel } from "../../components/recruitment/RoundsPanel";
import { DriveOverview, STAGES } from "../../components/recruitment/DriveOverview";
import { batchLabel, departmentsLabel, formatDateTime } from "../../lib/format";

const coverStyle = (src) => (src ? { "--cover": `url("${String(src).replace(/"/g, "%22")}")` } : undefined);

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
    // Clicking a role card you applied for opens that application and brings it into view.
    const [focused, setFocused] = useState(null);
    const [focusKey, setFocusKey] = useState(0);
    const openApplication = (applicationId) => {
        setFocused(applicationId);
        setFocusKey((value) => value + 1);
        requestAnimationFrame(() => document.getElementById(`application-${applicationId}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
    };
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

                    <div className={staff || !user ? "detail-layout aside-first-mobile" : "drive-single"}>
                        <div className="stack-lg">
                            {isStudent && !staff && myApplications.length > 0 && (
                                <section className="recruit-my-apps" aria-label="Your applications">
                                    <h2 className="recruit-section-title">
                                        Your applications <span className="subtle">· {myApplications.length}</span>
                                    </h2>
                                    {myApplications.map((application) => (
                                        <div key={`${application._id}-${focusKey}`} id={`application-${application._id}`}>
                                            <MyApplicationCard
                                                drive={drive}
                                                application={application}
                                                others={myApplications.filter((other) => other._id !== application._id)}
                                                onChange={refresh}
                                                defaultOpen={focused === application._id || myApplications.length === 1 ? true : undefined}
                                            />
                                        </div>
                                    ))}
                                </section>
                            )}
                            {tab === "overview" && <DriveOverview drive={drive} staff={staff} mine={myApplications} onOpenApplication={openApplication} />}
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
                            {staff && drive.counts && tab !== "overview" && (
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
