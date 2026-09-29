import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, ClipboardCheck, Flag, Lock, Megaphone, PencilLine, Send, Trash2, XCircle } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { Button, ButtonLink, Card, ConfirmDialog, Input, Modal } from "../ui";
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

    return (
        <>
            {viewer.canReview && (
                <Card className="recruit-review" title={<h2 className="row"><ClipboardCheck size={18} /> Your review</h2>}>
                    <div className="stack">
                        <p className="subtle small" style={{ margin: 0 }}>
                            Check each role and its application form. Once you approve, the president can publish it to students.
                        </p>
                        <Button block onClick={() => setDialog("approve")}>
                            Approve
                        </Button>
                        <Button block variant="secondary" onClick={() => setDialog("changes")}>
                            Request changes
                        </Button>
                        <Button block variant="ghost" onClick={() => setDialog("reject")}>
                            Reject
                        </Button>
                    </div>
                </Card>
            )}

            {viewer.canManage && !finished && (
                <Card title="Manage recruitment">
                    <div className="stack">
                        {editable && (
                            <>
                                <Button block onClick={() => run(() => recruitmentApi.submit(drive._id))}>
                                    <Send size={16} /> {drive.status === "NEEDS_CHANGES" ? "Resubmit for approval" : "Send for approval"}
                                </Button>
                                <ButtonLink block variant="secondary" to={`/recruitment/${drive._id}/edit`}>
                                    <PencilLine size={16} /> Edit drive
                                </ButtonLink>
                            </>
                        )}
                        {drive.status === "APPROVED" && (
                            <Button block variant="accent" onClick={() => setDialog("publish")}>
                                <Megaphone size={16} /> Publish recruitment
                            </Button>
                        )}
                        {beforeRounds && drive.phase !== "CLOSED" && (
                            <Button block variant="secondary" onClick={() => setDialog("close")}>
                                <Lock size={16} /> Close applications now
                            </Button>
                        )}
                        {beforeRounds && (
                            <Button block variant="secondary" onClick={() => setDialog("extend")}>
                                <CalendarClock size={16} /> {drive.phase === "CLOSED" ? "Reopen applications" : "Extend deadline"}
                            </Button>
                        )}
                        {selecting && (
                            <Button block variant="secondary" onClick={() => setDialog("complete")}>
                                <Flag size={16} /> Complete recruitment
                            </Button>
                        )}
                        {drive.status === "DRAFT" ? (
                            <Button block variant="ghost" onClick={() => setDialog("delete")}>
                                <Trash2 size={16} /> Delete draft
                            </Button>
                        ) : (
                            <Button block variant="ghost" onClick={() => setDialog("cancel")}>
                                <XCircle size={16} /> Cancel recruitment
                            </Button>
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
