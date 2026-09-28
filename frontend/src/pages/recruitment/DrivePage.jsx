import { Link, useParams, useSearchParams } from "react-router-dom";
import { Briefcase, FileText, Inbox, Layers, ListChecks, Megaphone, Send, Users } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { Alert, AsyncContent, Avatar, ButtonLink, Card, Tabs } from "../../components/ui";
import { Deadline, DriveStepper, PhaseBadge } from "../../components/recruitment/RecruitmentParts";
import { DriveActions } from "../../components/recruitment/DriveActions";
import { MyApplicationCard } from "../../components/recruitment/MyApplicationCard";
import { ApplicationsPanel } from "../../components/recruitment/ApplicationsPanel";
import { RoundsPanel } from "../../components/recruitment/RoundsPanel";
import { QuestionPreview } from "../../components/recruitment/QuestionPreview";
import { batchLabel, departmentsLabel, formatDateTime, humanize, plural } from "../../lib/format";

const coverStyle = (src) => (src ? { "--cover": `url("${String(src).replace(/"/g, "%22")}")` } : undefined);

// The drive's story for everyone: positions, who can apply, how it works.
const Overview = ({ drive, staff }) => (
    <div className="stack-lg">
        <Card title="About this recruitment">
            <p className="prose">{drive.description}</p>
        </Card>
        <Card title={<h2 className="row"><Briefcase size={18} /> Open positions</h2>}>
            <div className="recruit-positions">
                {drive.positions.map((position, index) => (
                    <div key={position._id} className="recruit-position" style={{ "--i": index }}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                            <strong>{position.title}</strong>
                            {position.openings ? <span className="recruit-chip">{plural(position.openings, "opening")}</span> : null}
                        </div>
                        {position.description && <p className="subtle small" style={{ margin: 0 }}>{position.description}</p>}
                        {staff && <span className="subtle small">Joins as {humanize(position.role).toLowerCase()}</span>}
                    </div>
                ))}
            </div>
        </Card>
        {staff && (
            <Card title={<h2 className="row"><ListChecks size={18} /> Application form · {plural(drive.questions.length, "question")}</h2>}>
                <div className="stack">
                    {drive.questions.length ? drive.questions.map((question) => <QuestionPreview key={question._id} question={question} />) : <p className="subtle">Applicants only choose positions.</p>}
                </div>
            </Card>
        )}
        {!staff && (
            <Card title="How selection works">
                <ol className="recruit-howto">
                    <li>
                        <strong>Apply</strong> before the deadline — it takes a few minutes.
                    </li>
                    <li>
                        <strong>Selection rounds</strong> — screening and interviews, online or on campus. You'll get an email invitation with the time and place, and reminders.
                    </li>
                    <li>
                        <strong>Results</strong> after each round, and a final decision. Selected students join the club.
                    </li>
                </ol>
            </Card>
        )}
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
    const tab = staff ? params.get("tab") || "overview" : "overview";
    const refresh = () => reload({ silent: true });

    const tabs = [
        { value: "overview", label: "Overview", icon: Layers },
        ...(["PUBLISHED", "COMPLETED", "CANCELLED"].includes(drive?.status)
            ? [
                  { value: "applications", label: "Applications", icon: Inbox, count: drive?.counts?.total ?? null },
                  { value: "rounds", label: "Rounds & results", icon: Users }
              ]
            : [])
    ];

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
                                {viewer.canApply ? (
                                    <ButtonLink to={`/recruitment/${drive._id}/apply`} variant="accent" size="lg">
                                        <Send size={17} /> Apply now
                                    </ButtonLink>
                                ) : viewer.application ? null : (
                                    viewer.applyProblem && <span className="hero-note">{viewer.applyProblem}</span>
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

                    {staff && tabs.length > 1 && (
                        <Tabs
                            tabs={tabs}
                            value={tab}
                            onChange={(value) => {
                                params.set("tab", value);
                                setParams(params, { replace: true });
                            }}
                        />
                    )}

                    <div className="detail-layout aside-first-mobile">
                        <div className="stack-lg">
                            {tab === "overview" && <Overview drive={drive} staff={staff} />}
                            {tab === "applications" && staff && <ApplicationsPanel drive={drive} />}
                            {tab === "rounds" && staff && <RoundsPanel drive={drive} onDriveChange={refresh} />}
                        </div>
                        <aside className="stack">
                            {isStudent && viewer.application && <MyApplicationCard drive={drive} onChange={refresh} />}
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
                                            <dt>Selected</dt>
                                            <dd>{drive.counts.selected}</dd>
                                        </div>
                                        <div>
                                            <dt>Rounds</dt>
                                            <dd>{drive.rounds.length}</dd>
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
