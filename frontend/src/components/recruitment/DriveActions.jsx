import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, ClipboardCheck, Flag, Lock, Megaphone, PencilLine, Send, Trash2, XCircle } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Button, ButtonLink, Card, ConfirmDialog, Input, Modal } from "../ui";
import { fromDateTimeInput, toDateTimeInput } from "../../lib/format";

const ExtendDialog = ({ drive, onClose, onDone }) => {
    const toast = useToast();
    const [value, setValue] = useState(toDateTimeInput(new Date(Math.max(new Date(drive.applicationEnd).getTime(), Date.now()) + 2 * 86400000)));
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true);
        try {
            const response = await recruitmentApi.extend(drive._id, fromDateTimeInput(value));
            toast.success(drive.closedAt ? "Applications reopened" : "Deadline extended");
            onDone(response.data);
            onClose();
        } catch (error) {
            toast.error(error);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Modal
            open
            onClose={onClose}
            title={drive.closedAt ? "Reopen applications" : "Extend the deadline"}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={save} loading={busy}>
                        Save deadline
                    </Button>
                </>
            }
        >
            <Input label="New deadline" type="datetime-local" value={value} min={toDateTimeInput(new Date())} onChange={(event) => setValue(event.target.value)} />
        </Modal>
    );
};

/** President's and mentor's actions for a drive, by stage. */
export const DriveActions = ({ drive, onChange }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [dialog, setDialog] = useState(null);
    const { viewer } = drive;

    const run = async (call, success) => {
        try {
            const response = await call();
            toast.success(success || response.message);
            if (response.data) {
                onChange(response.data);
            }
        } catch (error) {
            toast.error(error);
        }
    };
    const dialogRun = (call) => async (reason) => {
        const response = await call(reason);
        toast.success(response.message);
        onChange(response.data);
    };

    if (!viewer.canManage && !viewer.canReview) {
        return null;
    }
    const editable = ["DRAFT", "NEEDS_CHANGES"].includes(drive.status);
    const live = drive.status === "PUBLISHED";
    const beforeRounds = live && ["UPCOMING", "OPEN", "CLOSED"].includes(drive.phase);
    const finished = ["COMPLETED", "CANCELLED", "REJECTED"].includes(drive.status);
    const selecting = live && ["CLOSED", "ROUNDS"].includes(drive.phase);

    // One clear next step per stage; everything else sits in the card's "⋯" menu.
    const primary = editable
        ? { label: drive.status === "NEEDS_CHANGES" ? "Resubmit for approval" : "Send for approval", icon: Send, onClick: () => run(() => recruitmentApi.submit(drive._id)) }
        : drive.status === "APPROVED"
          ? { label: "Publish recruitment", icon: Megaphone, onClick: () => setDialog("publish"), variant: "accent" }
          : null;
    const menu = [
        { label: "Close applications now", icon: Lock, onClick: () => setDialog("close"), hidden: !(beforeRounds && drive.phase !== "CLOSED") },
        { label: drive.phase === "CLOSED" ? "Reopen applications" : "Extend deadline", icon: CalendarClock, onClick: () => setDialog("extend"), hidden: !beforeRounds },
        { label: "Complete recruitment", icon: Flag, onClick: () => setDialog("complete"), hidden: !selecting },
        "divider",
        drive.status === "DRAFT"
            ? { label: "Delete draft", icon: Trash2, onClick: () => setDialog("delete"), danger: true }
            : { label: "Cancel recruitment", icon: XCircle, onClick: () => setDialog("cancel"), danger: true }
    ];
    const hint = {
        DRAFT: "Finish the roles and forms, then send it to your faculty mentor.",
        NEEDS_CHANGES: "Make the changes your mentor asked for and resubmit.",
        PENDING_APPROVAL: "With your faculty mentor for approval.",
        APPROVED: "Approved — publishing notifies every eligible student.",
        UPCOMING: "Published — applications open soon.",
        OPEN: "Applications are open.",
        CLOSED: "Applications closed — start the selection for each role.",
        ROUNDS: "Selection is running role by role."
    }[drive.phase];

    return (
        <>
            {viewer.canReview && (
                <Card
                    className="recruit-review"
                    title={<h2 className="row"><ClipboardCheck size={18} /> Your review</h2>}
                    actions={<ActionMenu label="More review actions" items={[{ label: "Reject drive", icon: XCircle, onClick: () => setDialog("reject"), danger: true }]} />}
                >
                    <div className="stack">
                        <p className="subtle small" style={{ margin: 0 }}>
                            Check each role and its application form. Once you approve, the president can publish it to students.
                        </p>
                        <div className="recruit-action-pair">
                            <Button variant="secondary" onClick={() => setDialog("changes")}>
                                Request changes
                            </Button>
                            <Button onClick={() => setDialog("approve")}>Approve</Button>
                        </div>
                    </div>
                </Card>
            )}

            {viewer.canManage && !finished && (
                <Card title="Manage recruitment" actions={<ActionMenu label="Recruitment actions" items={menu} />}>
                    <div className="stack">
                        {hint && <p className="subtle small" style={{ margin: 0 }}>{hint}</p>}
                        {primary && (
                            <Button block variant={primary.variant} onClick={primary.onClick}>
                                <primary.icon size={16} /> {primary.label}
                            </Button>
                        )}
                        {editable && (
                            <ButtonLink block variant="ghost" to={`/recruitment/${drive._id}/edit`}>
                                <PencilLine size={16} /> Edit drive
                            </ButtonLink>
                        )}
                    </div>
                </Card>
            )}

            <ConfirmDialog
                open={dialog === "approve"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun((comment) => recruitmentApi.approve(drive._id, comment))}
                title="Approve this recruitment drive?"
                reasonLabel="Note for the president (optional)"
                confirmLabel="Approve"
            />
            <ConfirmDialog
                open={dialog === "changes"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun((comment) => recruitmentApi.requestChanges(drive._id, comment))}
                title="Request changes"
                reasonLabel="What should change?"
                reasonRequired
                confirmLabel="Send back"
            />
            <ConfirmDialog
                open={dialog === "reject"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun((comment) => recruitmentApi.reject(drive._id, comment))}
                title="Reject this drive?"
                reasonLabel="Reason"
                reasonRequired
                confirmLabel="Reject"
                variant="danger"
            />
            <ConfirmDialog
                open={dialog === "publish"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun(() => recruitmentApi.publish(drive._id))}
                title="Publish recruitment?"
                description="Every student who can join the club is notified and emailed, and applications open (or open at the time you set)."
                confirmLabel="Publish"
                variant="accent"
            />
            <ConfirmDialog
                open={dialog === "close"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun(() => recruitmentApi.close(drive._id))}
                title="Close applications now?"
                description="No one else can apply. You can reopen them until the first round starts."
                confirmLabel="Close applications"
            />
            <ConfirmDialog
                open={dialog === "complete"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun(() => recruitmentApi.complete(drive._id))}
                title="Complete recruitment now?"
                description="Recruitment usually completes by itself once every role has its members. Completing now closes every open application — anyone still in selection, on a reserve list or with an unanswered offer is thanked by email. Students who already accepted stay members."
                confirmLabel="Complete recruitment"
            />
            <ConfirmDialog
                open={dialog === "cancel"}
                onClose={() => setDialog(null)}
                onConfirm={dialogRun((reason) => recruitmentApi.cancel(drive._id, reason))}
                title="Cancel this recruitment?"
                description="Every applicant is told by email and the drive ends. This can't be undone."
                reasonLabel="Reason for applicants (optional)"
                confirmLabel="Cancel recruitment"
                variant="danger"
            />
            <ConfirmDialog
                open={dialog === "delete"}
                onClose={() => setDialog(null)}
                onConfirm={async () => {
                    await recruitmentApi.remove(drive._id);
                    toast.success("Draft deleted");
                    navigate(`/clubs/${drive.club._id}/recruitment`);
                }}
                title="Delete this draft?"
                confirmLabel="Delete"
                variant="danger"
            />
            {dialog === "extend" && <ExtendDialog drive={drive} onClose={() => setDialog(null)} onDone={onChange} />}
        </>
    );
};
