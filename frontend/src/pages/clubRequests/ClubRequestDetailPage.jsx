import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, CheckCircle2, FilePenLine, MessageSquareWarning, PencilLine, ShieldCheck, X, XCircle } from "lucide-react";
import { clubRequestApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Avatar, Badge, Button, ButtonLink, Card, ConfirmDialog, PageHeader, StatusBadge } from "../../components/ui";
import { formatDateTime, humanize } from "../../lib/format";

const STEPS = ["Submitted", "Faculty review", "Admin approval", "Club created"];

// Where the request stands: 0 submitted, 1 with the faculty, 2 with the admin, 3 club created. A request
// sent back for changes waits with its founders at the faculty step; a rejection is shown where it happened.
const stepState = (request) => {
    const { status } = request;
    if (status === "APPROVED") return { current: STEPS.length, mark: null };
    if (status === "FACULTY_VERIFIED") return { current: 2, mark: null };
    if (status === "NEEDS_CHANGES") return { current: 1, mark: "attention" };
    if (status === "REJECTED") return { current: request.verifiedAt ? 2 : 1, mark: "rejected" };
    return { current: 1, mark: null };
};

const STEP_NOTE = { attention: "Changes requested", rejected: "Rejected" };

const Progress = ({ request }) => {
    const { current, mark } = stepState(request);
    return (
        <ol className="workflow request-workflow" aria-label="Request progress">
            {STEPS.map((label, index) => {
                const done = index < current;
                const here = index === current;
                const state = done ? "done" : here ? (mark ? `current is-${mark}` : "current") : "";
                const Icon = here && mark === "rejected" ? X : here && mark === "attention" ? PencilLine : done ? Check : null;
                return (
                    <li key={label} className={`step ${state}`} aria-current={here ? "step" : undefined}>
                        <span className="step-dot">{Icon ? <Icon size={13} strokeWidth={3} /> : index + 1}</span>
                        <span className="step-label">{here && mark ? STEP_NOTE[mark] : label}</span>
                    </li>
                );
            })}
        </ol>
    );
};

const Section = ({ title, children }) => (
    <div>
        <div className="section-title">{title}</div>
        <p className="prose">{children}</p>
    </div>
);

const ClubRequestDetailPage = () => {
    const { id } = useParams();
    const { user, isFaculty, isAdmin } = useAuth();
    const toast = useToast();
    const { data: request, loading, error, reload, setData } = useApi(() => clubRequestApi.get(id), [id]);
    const [dialog, setDialog] = useState(null);

    const run = (fn, message) => async (text) => {
        const response = await fn(text);
        setData(response.data.request || response.data);
        toast.success(message);
        if (response.data.club) {
            reload({ silent: true });
        }
    };

    const facultyCanReview =
        isFaculty && request?.status === "PENDING_FACULTY_REVIEW" && (!request.proposedMentor || request.proposedMentor._id === user._id);
    const adminCanDecide = isAdmin && request?.status === "FACULTY_VERIFIED";
    const isRequester = request?.requester?._id === user._id;

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {request && (
                <>
                    <PageHeader
                        back={{ to: isAdmin ? "/admin/club-requests" : "/club-requests", label: "Club requests" }}
                        title={request.name}
                        actions={<StatusBadge status={request.status} />}
                    />

                    <div className="detail-layout">
                        <div className="stack-lg">
                            <Progress request={request} />

                            {request.status === "NEEDS_CHANGES" && (
                                <Alert type="warning" title="Changes requested">
                                    {request.reviewComment}
                                    {isRequester && (
                                        <div style={{ marginTop: 10 }}>
                                            <ButtonLink to={`/club-requests/${id}/edit`} size="sm">
                                                <FilePenLine size={14} /> Update & resubmit
                                            </ButtonLink>
                                        </div>
                                    )}
                                </Alert>
                            )}
                            {request.status === "REJECTED" && (
                                <Alert type="error" title={`Rejected by ${request.decidedBy?.name || "reviewer"}`}>
                                    {request.rejectionReason}
                                </Alert>
                            )}
                            {request.status === "APPROVED" && request.club && (
                                <Alert type="success" title="Approved — the club has been created">
                                    <Link to={`/clubs/${request.club._id}`}>Open {request.club.name}</Link>. The faculty mentor will appoint the president.
                                </Alert>
                            )}
                            {request.status === "FACULTY_VERIFIED" && (
                                <Alert type="info" title={`Verified by ${request.verifiedBy?.name}`}>
                                    {request.reviewComment ? `“${request.reviewComment}” — ` : ""}Waiting for the university admin's final approval.
                                </Alert>
                            )}

                            <Card title="Proposal">
                                <div className="stack">
                                    <Section title="Description">{request.description}</Section>
                                    <Section title="Purpose">{request.purpose}</Section>
                                    <Section title="Proposed activities">{request.proposedActivities}</Section>
                                    <Section title="Why this club">{request.reason}</Section>
                                </div>
                            </Card>

                            <Card title="History">
                                <ul className="timeline">
                                    {[...request.history].reverse().map((entry, index) => (
                                        <li key={index}>
                                            <span className="timeline-dot" />
                                            <div>
                                                <strong>{humanize(entry.action.replace("CLUB_REQUEST_", ""))}</strong>
                                                <span className="subtle"> · {entry.actor?.name} · {formatDateTime(entry.at)}</span>
                                                {entry.reason && <p className="small muted">“{entry.reason}”</p>}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        </div>

                        <aside className="stack">
                            {facultyCanReview && (
                                <Card title="Faculty review">
                                    <div className="stack-sm">
                                        <p className="subtle">Verifying sends this to the university admin. If approved, you become the club's faculty mentor.</p>
                                        <Button variant="success" block onClick={() => setDialog("verify")}>
                                            <CheckCircle2 size={16} /> Verify
                                        </Button>
                                        <Button variant="secondary" block onClick={() => setDialog("changes")}>
                                            <MessageSquareWarning size={16} /> Request changes
                                        </Button>
                                        <Button variant="ghost" block onClick={() => setDialog("reject")}>
                                            <XCircle size={16} /> Reject
                                        </Button>
                                    </div>
                                </Card>
                            )}
                            {adminCanDecide && (
                                <Card title="Final approval">
                                    <div className="stack-sm">
                                        <p className="subtle">Approving creates the club with {request.verifiedBy?.name} as faculty mentor and the founders as members.</p>
                                        <Button variant="success" block onClick={() => setDialog("approve")}>
                                            <ShieldCheck size={16} /> Approve & create club
                                        </Button>
                                        <Button variant="ghost" block onClick={() => setDialog("reject")}>
                                            <XCircle size={16} /> Reject
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            <Card title="People">
                                <div className="stack">
                                    <div className="row" style={{ flexWrap: "nowrap" }}>
                                        <Avatar name={request.requester?.name} size="sm" />
                                        <div>
                                            <strong>{request.requester?.name}</strong> <Badge>Requester</Badge>
                                            <div className="subtle">{request.requester?.email}</div>
                                        </div>
                                    </div>
                                    {request.foundingMembers?.map((member) => (
                                        <div key={member._id} className="row" style={{ flexWrap: "nowrap" }}>
                                            <Avatar name={member.name} size="sm" />
                                            <div>
                                                <strong>{member.name}</strong>
                                                <div className="subtle">{member.email}</div>
                                            </div>
                                        </div>
                                    ))}
                                    {(request.verifiedBy || request.proposedMentor) && (
                                        <div className="row" style={{ flexWrap: "nowrap" }}>
                                            <Avatar name={(request.verifiedBy || request.proposedMentor).name} size="sm" />
                                            <div>
                                                <strong>{(request.verifiedBy || request.proposedMentor).name}</strong>{" "}
                                                <Badge tone="gold">{request.verifiedBy ? "Verifying faculty" : "Requested reviewer"}</Badge>
                                                <div className="subtle">{(request.verifiedBy || request.proposedMentor).email}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </aside>
                    </div>

                    <ConfirmDialog
                        open={dialog === "verify"}
                        onClose={() => setDialog(null)}
                        title="Verify this club request?"
                        description="It will be sent to the university admin for final approval."
                        confirmLabel="Verify"
                        variant="success"
                        reasonLabel="Comment for the admin"
                        onConfirm={run((comment) => clubRequestApi.verify(id, comment || undefined), "Request verified and sent to the admin")}
                    />
                    <ConfirmDialog
                        open={dialog === "changes"}
                        onClose={() => setDialog(null)}
                        title="Request changes"
                        description="The students can edit the proposal and resubmit it to you."
                        confirmLabel="Send request"
                        reasonLabel="What should they change?"
                        reasonRequired
                        onConfirm={run((comment) => clubRequestApi.requestChanges(id, comment), "Changes requested")}
                    />
                    <ConfirmDialog
                        open={dialog === "reject"}
                        onClose={() => setDialog(null)}
                        title="Reject this club request?"
                        description="Rejection is final. The students are notified by email."
                        confirmLabel="Reject"
                        variant="danger"
                        reasonLabel="Reason"
                        reasonRequired
                        onConfirm={run((reason) => clubRequestApi.reject(id, reason), "Request rejected")}
                    />
                    <ConfirmDialog
                        open={dialog === "approve"}
                        onClose={() => setDialog(null)}
                        title={`Approve ${request.name}?`}
                        description={`The club is created with ${request.verifiedBy?.name} as faculty mentor. The mentor then appoints a president.`}
                        confirmLabel="Approve & create club"
                        variant="success"
                        onConfirm={run(() => clubRequestApi.approve(id), "Club approved and created")}
                    />
                </>
            )}
        </AsyncContent>
    );
};

export default ClubRequestDetailPage;
