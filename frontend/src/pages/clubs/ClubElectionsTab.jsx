import { useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Vote } from "lucide-react";
import { electionApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useChat } from "../../context/ChatContext";
import { AsyncContent, ButtonLink, EmptyState } from "../../components/ui";
import { ElectionSummary } from "../../components/elections/ElectionParts";

// The club's elections: anonymous member votes for its roles, e.g. a new president when the old one
// leaves or the academic year ends. Open to the club's members and its faculty mentor.
const ClubElectionsTab = () => {
    const { club } = useOutletContext();
    const { on } = useChat();
    const { data, loading, error, reload } = useApi(() => electionApi.list(club._id), [club._id]);

    // Turnout and status change as members vote; the list follows along.
    useEffect(() => on?.("election:updated", () => reload({ silent: true })), [on, reload]);

    const items = data?.items || [];
    const live = items.filter((election) => ["SCHEDULED", "OPEN"].includes(election.status));
    const past = items.filter((election) => !["SCHEDULED", "OPEN"].includes(election.status));
    const link = (election) => `/clubs/${club._id}/elections/${election._id}`;

    return (
        <div className="stack">
            <div className="row-between">
                <span className="muted">Secret votes among members to choose who takes on a club role.</span>
                {data?.canManage && (
                    <ButtonLink to={`/clubs/${club._id}/elections/new`}>
                        <Plus size={16} /> New election
                    </ButtonLink>
                )}
            </div>
            <AsyncContent loading={loading} error={error} onRetry={reload}>
                {items.length === 0 ? (
                    <EmptyState
                        icon={Vote}
                        title="No elections yet"
                        description={
                            data?.canManage
                                ? "When a leader steps down or the year ends, hold an election so members can choose fairly."
                                : "When the club holds an election, you'll vote here and in the club group."
                        }
                    />
                ) : (
                    <>
                        {live.length > 0 && (
                            <section className="stack-sm">
                                <h2 className="section-title">Now</h2>
                                <div className="election-grid">
                                    {live.map((election) => (
                                        <ElectionSummary key={election._id} election={election} to={link(election)} />
                                    ))}
                                </div>
                            </section>
                        )}
                        {past.length > 0 && (
                            <section className="stack-sm">
                                <h2 className="section-title">Past elections</h2>
                                <div className="election-grid">
                                    {past.map((election) => (
                                        <ElectionSummary key={election._id} election={election} to={link(election)} />
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </AsyncContent>
        </div>
    );
};

export default ClubElectionsTab;
