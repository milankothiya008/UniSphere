import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    Ban,
    CheckCircle2,
    ClipboardList,
    FilePenLine,
    Flag,
    Lock,
    MessageSquareWarning,
    Rocket,
    ScanLine,
    Send,
    Trophy,
    Unlock,
    XCircle
} from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { Button, Card, ConfirmDialog } from "../ui";

const CANCELLABLE = ["DRAFT", "PENDING_APPROVAL", "NEEDS_CHANGES", "APPROVED", "PUBLISHED"];

// Club-side and mentor-side controls for an event. Visibility follows the `viewer` flags from the API;
// every action is still authorised by the backend.
export const EventActions = ({ event, onChange }) => {
    const toast = useToast();
    const navigate = useNavigate();
    const [dialog, setDialog] = useState(null);
    const [busy, setBusy] = useState(null);
    const viewer = event.viewer || {};
    const started = new Date(event.startAt) <= new Date();

    const act = async (key, fn, message) => {
        setBusy(key);
        try {
            const response = await fn();
            toast.success(message);
            onChange(response.data);
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(null);
        }
    };

    // Dialog actions throw so the dialog can show the error inline.
    const dialogAction = (fn, message) => async (reason) => {
        const response = await fn(reason);
        toast.success(message);
        onChange(response.data);
    };

    const staffActions = [];

    // Everything can be edited until the event starts; approved and published events go back to the mentor.
    if (viewer.canEdit && !event.revision) {
        staffActions.push(
            <Button key="edit" variant="secondary" block onClick={() => navigate(`/events/${event._id}/edit`)}>
                <FilePenLine size={16} /> {["APPROVED", "PUBLISHED"].includes(event.status) ? "Edit details" : "Edit draft"}
            </Button>
        );
    }

    if (viewer.canManage && ["DRAFT", "NEEDS_CHANGES"].includes(event.status)) {
        staffActions.push(
            <Button key="submit" block loading={busy === "submit"} onClick={() => act("submit", () => eventApi.submit(event._id), "Submitted to your faculty mentor")}>
                <Send size={16} /> {event.status === "NEEDS_CHANGES" ? "Resubmit for approval" : "Submit for approval"}
            </Button>
        );
    }

    if (viewer.canPublish && event.status === "APPROVED") {
        staffActions.push(
            <Button key="publish" variant="accent" block onClick={() => setDialog("publish")}>
                <Rocket size={16} /> Publish event
            </Button>
        );
    }

    if (viewer.canManage && event.status === "PUBLISHED") {
        staffActions.push(
            <Button
                key="toggle-registration"
                variant="secondary"
                block
                loading={busy === "toggle"}
                onClick={() =>
                    act(
                        "toggle",
                        () => eventApi.update(event._id, { registrationClosed: !event.registrationClosed }),
                        event.registrationClosed ? "Registration reopened" : "Registration closed"
                    )
                }
            >
                {event.registrationClosed ? <Unlock size={16} /> : <Lock size={16} />}
                {event.registrationClosed ? "Reopen registration" : "Close registration"}
            </Button>
        );
    }

    if (viewer.canViewParticipants && ["PUBLISHED", "COMPLETED", "CANCELLED"].includes(event.status)) {
        staffActions.push(
            <Link key="participants" to={`/events/${event._id}/participants`} className="btn btn-secondary btn-block">
                <ClipboardList size={16} /> Participants ({event.registeredCount})
            </Link>
        );
    }

    const checkInOpen = event.checkIn?.status === "OPEN";
    if (viewer.canMarkAttendance && checkInOpen) {
        staffActions.push(
            <Link key="scanner" to={`/events/${event._id}/check-in`} className="btn btn-accent btn-block">
                <ScanLine size={16} /> Check-in scanner
            </Link>
        );
    }
    if (viewer.canManageCheckIn && event.status === "PUBLISHED") {
        staffActions.push(
            <Button key="checkin" variant={checkInOpen ? "secondary" : "primary"} block onClick={() => setDialog(checkInOpen ? "checkin-close" : "checkin-open")}>
                {checkInOpen ? <Lock size={16} /> : <ScanLine size={16} />}
                {checkInOpen ? "Close check-in" : event.checkIn?.status === "CLOSED" ? "Reopen check-in" : "Start check-in"}
            </Button>
        );
    }

    if (viewer.canManage && event.status === "PUBLISHED" && started) {
        staffActions.push(
            <Button key="complete" variant="success" block onClick={() => setDialog("complete")}>
                <Flag size={16} /> Mark as completed
            </Button>
        );
    }

    // Results open once the event is published: round standings any time, final results after it starts.
    if (viewer.canManageResults && ["PUBLISHED", "COMPLETED"].includes(event.status)) {
        staffActions.push(
            <Link key="results" to={`/events/${event._id}/results/edit`} className="btn btn-accent btn-block">
                <Trophy size={16} /> Manage results
            </Link>
        );
    }

    if (viewer.canPublish && CANCELLABLE.includes(event.status)) {
        staffActions.push(
            <Button key="cancel" variant="ghost" block onClick={() => setDialog("cancel")}>
                <Ban size={16} /> Cancel event
            </Button>
        );
    }

    const reviewActions = viewer.canReview ? (
        <Card title="Mentor review">
            <div className="stack-sm">
                <p className="subtle">Check the schedule, venue and details before approving. The event stays private until the club publishes it.</p>
                <Button variant="success" block onClick={() => setDialog("approve")}>
                    <CheckCircle2 size={16} /> Approve
                </Button>
                <Button variant="secondary" block onClick={() => setDialog("changes")}>
                    <MessageSquareWarning size={16} /> Request changes
                </Button>
                <Button variant="ghost" block onClick={() => setDialog("reject")}>
                    <XCircle size={16} /> Reject
                </Button>
            </div>
        </Card>
    ) : null;

    if (!staffActions.length && !reviewActions) {
        return null;
    }

    const close = () => setDialog(null);

    return (
        <>
            {reviewActions}
            {staffActions.length > 0 && (
                <Card title="Manage event">
                    <div className="stack-sm">{staffActions}</div>
                </Card>
            )}

            <ConfirmDialog
                open={dialog === "publish"}
                onClose={close}
                title="Publish this event?"
                description="It will appear in event discovery and the campus feed, and students can start registering."
                confirmLabel="Publish"
                variant="accent"
                onConfirm={dialogAction(() => eventApi.publish(event._id), "Event published to the campus feed")}
            />
            <ConfirmDialog
                open={dialog === "checkin-open"}
                onClose={close}
                title={event.checkIn?.status === "CLOSED" ? "Reopen check-in?" : "Start check-in?"}
                description="Every club officer is notified and can scan tickets or mark students present from their phone. You can close it any time."
                confirmLabel={event.checkIn?.status === "CLOSED" ? "Reopen check-in" : "Start check-in"}
                variant="accent"
                onConfirm={dialogAction(() => eventApi.openCheckIn(event._id), "Check-in is open — officers can now scan tickets")}
            />
            <ConfirmDialog
                open={dialog === "checkin-close"}
                onClose={close}
                title="Close check-in?"
                description="Scanning stops for everyone. Reopen it later to make corrections."
                confirmLabel="Close check-in"
                onConfirm={dialogAction(() => eventApi.closeCheckIn(event._id), "Check-in closed")}
            />
            <ConfirmDialog
                open={dialog === "complete"}
                onClose={close}
                title="Mark event as completed?"
                description="Registration closes permanently and you can then publish results."
                confirmLabel="Mark completed"
                variant="success"
                onConfirm={dialogAction(() => eventApi.complete(event._id), "Event marked as completed")}
            />
            <ConfirmDialog
                open={dialog === "cancel"}
                onClose={close}
                title="Cancel this event?"
                description={
                    event.status === "PUBLISHED"
                        ? "Registered participants will be notified by email and a cancellation notice is posted to the feed."
                        : "The event will be cancelled and can no longer be submitted or published."
                }
                confirmLabel="Cancel event"
                variant="danger"
                reasonLabel="Reason"
                reasonRequired={event.status === "PUBLISHED"}
                onConfirm={dialogAction((reason) => eventApi.cancel(event._id, reason || undefined), "Event cancelled")}
            />
            <ConfirmDialog
                open={dialog === "approve"}
                onClose={close}
                title="Approve this event?"
                description="The club will be notified and can publish it."
                confirmLabel="Approve"
                variant="success"
                reasonLabel="Note for the club"
                onConfirm={dialogAction((comment) => eventApi.approve(event._id, comment || undefined), "Event approved")}
            />
            <ConfirmDialog
                open={dialog === "changes"}
                onClose={close}
                title="Request changes"
                description="The club can edit the event and resubmit it for your review."
                confirmLabel="Send request"
                reasonLabel="What needs to change?"
                reasonRequired
                onConfirm={dialogAction((comment) => eventApi.requestChanges(event._id, comment), "Changes requested")}
            />
            <ConfirmDialog
                open={dialog === "reject"}
                onClose={close}
                title="Reject this event?"
                description="Rejection is final — the club would need to create a new event."
                confirmLabel="Reject event"
                variant="danger"
                reasonLabel="Reason"
                reasonRequired
                onConfirm={dialogAction((reason) => eventApi.reject(event._id, reason), "Event rejected")}
            />
        </>
    );
};
