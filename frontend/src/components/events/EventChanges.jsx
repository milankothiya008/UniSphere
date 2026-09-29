import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, FilePenLine, GitCompareArrows, MessageSquareWarning, Rocket, Trash2, XCircle } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { batchLabel, formatDateLong, formatDateTime, humanize, timeAgo } from "../../lib/format";
import { Badge, Button, Card, ConfirmDialog, MediaFill } from "../ui";

const STATUS = {
    PENDING_APPROVAL: { tone: "warning", label: "Waiting for mentor approval" },
    NEEDS_CHANGES: { tone: "warning", label: "Mentor asked for changes" },
    APPROVED: { tone: "success", label: "Approved — ready to publish" },
    REJECTED: { tone: "danger", label: "Not approved" }
};

const LONG_TEXT = ["description", "rules", "shortDescription"];

// Human-readable value of one event field, as shown in the comparison.
const show = (field, value) => {
    if (value === null || value === undefined || value === "") {
        return field === "maxParticipants" ? "No limit" : "—";
    }
    switch (field) {
        case "eventDate":
            return formatDateLong(value);
        case "registrationStart":
        case "registrationEnd":
            return formatDateTime(value);
        case "venue":
        case "organizer":
            return value.name || "—";
        case "category":
        case "participationMode":
            return humanize(value);
        case "eligibility": {
            const departments = value.departments?.length ? value.departments.join(", ") : "All departments";
            const batches = value.batches?.length ? value.batches.map((b) => `Batch ${batchLabel(b)}`).join(", ") : "All batches";
            return [departments, batches, value.notes].filter(Boolean).join(" · ");
        }
        case "contact":
            return [value.name, value.email, value.phone].filter(Boolean).join(" · ") || "—";
        case "poster":
            return (
                <span className="change-poster">
                    <MediaFill src={value} />
                </span>
            );
        default:
            return String(value);
    }
};

/** Proposed changes to a published event: what changes, where the review stands, and the next step. */
export const EventChanges = ({ event, onChange }) => {
    const toast = useToast();
    const navigate = useNavigate();
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(false);
    const revision = event.revision;
    const viewer = event.viewer || {};

    if (!revision) {
        return null;
    }

    const status = STATUS[revision.status] || STATUS.PENDING_APPROVAL;
    const run = (fn, message) => async (text) => {
        const response = await fn(text);
        toast.success(message);
        onChange(response.data);
    };

    const publish = async () => {
        setBusy(true);
        try {
            const response = await eventApi.publishChanges(event._id);
            toast.success("Changes published — registered students have been notified");
            onChange(response.data);
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card
            className={`changes-card is-${revision.status.toLowerCase()}`}
            title={
                <h2 className="row">
                    <GitCompareArrows size={18} /> Proposed changes
                </h2>
            }
            actions={<Badge tone={status.tone}>{status.label}</Badge>}
        >
            <div className="stack">
                <p className="subtle small" style={{ margin: 0 }}>
                    Requested by {revision.requestedBy?.name || "the club"} {timeAgo(revision.requestedAt)}. Students see the current details until the changes are published.
                </p>

                <div className="change-list">
                    {revision.diff.map((change) => (
                        <div key={change.field} className={`change-row ${LONG_TEXT.includes(change.field) ? "is-long" : ""}`}>
                            <span className="change-label">{change.label}</span>
                            <div className="change-values">
                                <span className="change-from">{show(change.field, change.from)}</span>
                                <ArrowRight size={15} className="change-arrow" aria-label="changes to" />
                                <span className="change-to">{show(change.field, change.to)}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {revision.note && (
                    <div className="change-note">
                        <strong>Message to registered students</strong>
                        <p className="pre-line">{revision.note}</p>
                    </div>
                )}

                {revision.reviewComment && (
                    <div className={`change-review is-${revision.status.toLowerCase()}`}>
                        <strong>{revision.reviewedBy?.name || "Mentor"}:</strong> {revision.reviewComment}
                    </div>
                )}

                <div className="change-actions">
                    {viewer.canReviewChanges && (
                        <>
                            <Button variant="success" onClick={() => setDialog("approve")}>
                                <CheckCircle2 size={16} /> Approve changes
                            </Button>
                            <Button variant="secondary" onClick={() => setDialog("changes")}>
                                <MessageSquareWarning size={16} /> Request changes
                            </Button>
                            <Button variant="ghost" onClick={() => setDialog("reject")}>
                                <XCircle size={16} /> Reject
                            </Button>
                        </>
                    )}
                    {viewer.canPublishChanges && (
                        <Button variant="accent" onClick={publish} loading={busy}>
                            <Rocket size={16} /> Publish changes
                        </Button>
                    )}
                    {viewer.canManage && viewer.canEdit && (
                        <Button variant="secondary" onClick={() => navigate(`/events/${event._id}/edit`)}>
                            <FilePenLine size={16} /> {revision.status === "REJECTED" ? "Edit again" : "Edit changes"}
                        </Button>
                    )}
                    {viewer.canManage && (
                        <Button variant="ghost" onClick={() => setDialog("discard")}>
                            <Trash2 size={16} /> Discard
                        </Button>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={dialog === "approve"}
                onClose={() => setDialog(null)}
                title="Approve these changes?"
                description="The club can then publish them, and everyone registered will be notified."
                confirmLabel="Approve changes"
                variant="success"
                reasonLabel="Note for the club"
                onConfirm={run((comment) => eventApi.approveChanges(event._id, comment || undefined), "Changes approved")}
            />
            <ConfirmDialog
                open={dialog === "changes"}
                onClose={() => setDialog(null)}
                title="Request changes to this edit"
                description="The club can adjust the edit and send it again. The live event is not affected."
                confirmLabel="Send request"
                reasonLabel="What needs to change?"
                reasonRequired
                onConfirm={run((comment) => eventApi.requestChangesToEdit(event._id, comment), "Changes requested")}
            />
            <ConfirmDialog
                open={dialog === "reject"}
                onClose={() => setDialog(null)}
                title="Reject these changes?"
                description="The event stays exactly as it is now."
                confirmLabel="Reject changes"
                variant="danger"
                reasonLabel="Reason"
                reasonRequired
                onConfirm={run((reason) => eventApi.rejectChanges(event._id, reason), "Changes rejected")}
            />
            <ConfirmDialog
                open={dialog === "discard"}
                onClose={() => setDialog(null)}
                title="Discard these changes?"
                description="The proposal is deleted and the event stays as it is."
                confirmLabel="Discard changes"
                variant="danger"
                onConfirm={run(() => eventApi.discardChanges(event._id), "Changes discarded")}
            />
        </Card>
    );
};
