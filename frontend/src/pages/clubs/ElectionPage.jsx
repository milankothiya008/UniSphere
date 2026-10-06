import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Ban, CalendarClock, ChevronLeft, PencilLine, Repeat, Square, Vote } from "lucide-react";
import { electionApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Alert, AsyncContent, ButtonLink, Card, ConfirmDialog, Input } from "../../components/ui";
import { Ballot, ElectionStatus, Results, Turnout, electionTiming } from "../../components/elections/ElectionParts";
import { formatDateTime, fromDateTimeInput, toDateTimeInput } from "../../lib/format";

const inDays = (days) => toDateTimeInput(new Date(Date.now() + days * 86400000));

// One election: the ballot while voting is open, the counts once it has closed, and the organiser's actions.
const ElectionPage = () => {
    const { club } = useOutletContext();
    const { electionId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { on } = useChat();
    const { data: election, loading, error, reload, setData } = useApi(() => electionApi.get(electionId), [electionId]);
    const [dialog, setDialog] = useState(null);
    const [runoffCloses, setRunoffCloses] = useState(() => inDays(2));

    useEffect(() => on?.("election:updated", ({ electionId: changed }) => changed === electionId && reload({ silent: true })), [on, reload, electionId]);

    const back = `/clubs/${club._id}/elections`;
    const viewer = election?.viewer || {};
    const live = ["SCHEDULED", "OPEN"].includes(election?.status);

    const close = async () => {
        setData((await electionApi.close(electionId)).data);
        toast.success("Voting closed — the result is out");
    };
    const cancel = async (reason) => {
        setData((await electionApi.cancel(electionId, reason)).data);
        toast.success("Election cancelled");
    };
    const runoff = async () => {
        const response = await electionApi.runoff(electionId, { closesAt: fromDateTimeInput(runoffCloses) });
        toast.success("Runoff started");
        navigate(`/clubs/${club._id}/elections/${response.data._id}`);
    };

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {election && (
                <div className="stack election-page">
                    <div className="row-between">
                        <ButtonLink to={back} variant="ghost" size="sm">
                            <ChevronLeft size={16} /> Elections
                        </ButtonLink>
                        {viewer.canManage && (live || viewer.canRunoff) && (
                            <ActionMenu
                                label="Election actions"
                                items={[
                                    {
                                        label: "Edit",
                                        icon: PencilLine,
                                        hidden: election.status !== "SCHEDULED",
                                        onClick: () => navigate(`/clubs/${club._id}/elections/new?edit=${election._id}`)
                                    },
                                    { label: "End voting now", icon: Square, hidden: election.status !== "OPEN", onClick: () => setDialog("close") },
                                    { label: "Hold a runoff", icon: Repeat, hidden: !viewer.canRunoff, onClick: () => setDialog("runoff") },
                                    { label: "Cancel election", icon: Ban, danger: true, hidden: !live, onClick: () => setDialog("cancel") }
                                ]}
                            />
                        )}
                    </div>

                    <Card>
                        <div className="stack">
                            <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                                <div className="stack-xs">
                                    <h1 className="election-title">{election.title}</h1>
                                    <span className="muted">
                                        For {election.roleName} · organised by {election.createdBy?.name || "the club"}
                                    </span>
                                </div>
                                <ElectionStatus election={election} />
                            </div>
                            {election.description && (
                                <p className="pre-line" style={{ margin: 0 }}>
                                    {election.description}
                                </p>
                            )}
                            <span className="small subtle row" style={{ gap: 6 }}>
                                <CalendarClock size={14} /> {electionTiming(election)}
                                {election.status === "SCHEDULED" && ` · closes ${formatDateTime(election.closesAt)}`}
                            </span>
                            <Turnout election={election} />
                            {election.runoffOf && <span className="small subtle">Runoff between the candidates who tied.</span>}
                        </div>
                    </Card>

                    {election.status === "CANCELLED" && (
                        <Alert type="warning" title="This election was cancelled">
                            {election.cancelReason || "No result will be announced."}
                        </Alert>
                    )}

                    {election.status === "CLOSED" ? (
                        <Card title="Result">
                            <Results election={election} />
                        </Card>
                    ) : election.status === "OPEN" && viewer.canVote ? (
                        <Card
                            title={
                                <h2 className="row">
                                    <Vote size={18} /> Your vote
                                </h2>
                            }
                        >
                            <Ballot election={election} onVoted={setData} />
                        </Card>
                    ) : (
                        <Card title="Candidates">
                            <div className="stack">
                                {viewer.hasVoted && <Alert type="success">You voted. The counts are shown when voting closes.</Alert>}
                                {election.status === "OPEN" && !viewer.eligible && (
                                    <Alert type="info">
                                        Only members who were in the club when voting opened can vote
                                        {club.viewer?.isMentor ? " — as mentor, you'll see the result when it closes" : ""}.
                                    </Alert>
                                )}
                                {election.status === "SCHEDULED" && (
                                    <Alert type="info">Voting hasn't opened yet. You'll get a notification when it does.</Alert>
                                )}
                                <ul className="election-candidates">
                                    {election.candidates.map((candidate) => (
                                        <li key={candidate.user?._id}>
                                            <strong>{candidate.user?.name}</strong>
                                            {candidate.statement && <span className="small muted">{candidate.statement}</span>}
                                            {!candidate.stillMember && <span className="small subtle">Has left the club</span>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </Card>
                    )}

                    <ConfirmDialog
                        open={dialog === "close"}
                        onClose={() => setDialog(null)}
                        onConfirm={close}
                        title="End voting now?"
                        description={`${election.votesCast} of ${election.eligibleCount} members have voted. The counts will be shown to the club straight away.`}
                        confirmLabel="End voting"
                    />
                    <ConfirmDialog
                        open={dialog === "cancel"}
                        onClose={() => setDialog(null)}
                        onConfirm={cancel}
                        title="Cancel this election?"
                        description="No result will be announced. Members who were asked to vote are told it was called off."
                        confirmLabel="Cancel election"
                        variant="danger"
                        reasonLabel="Reason (shared with members)"
                        reasonPlaceholder="e.g. Decided at the general meeting"
                        minReasonLength={0}
                    />
                    <ConfirmDialog
                        open={dialog === "runoff"}
                        onClose={() => setDialog(null)}
                        onConfirm={runoff}
                        title="Hold a runoff?"
                        description="A new secret vote between the candidates who tied. It opens straight away."
                        confirmLabel="Start runoff"
                    >
                        <Input
                            type="datetime-local"
                            label="Voting closes"
                            value={runoffCloses}
                            onChange={(event) => setRunoffCloses(event.target.value)}
                            required
                        />
                    </ConfirmDialog>
                </div>
            )}
        </AsyncContent>
    );
};

export default ElectionPage;
