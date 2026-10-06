import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, Crown, Lock, ShieldCheck, Vote } from "lucide-react";
import { electionApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Avatar, Badge, Button, ConfirmDialog } from "../ui";
import { formatDateTime, timeAgo } from "../../lib/format";

// Club elections: an anonymous vote among the club's members for one of its roles. The result is advisory —
// the president makes the appointment.

export const ELECTION_STATUS = {
    SCHEDULED: ["Scheduled", "info"],
    OPEN: ["Voting open", "success"],
    CLOSED: ["Closed", "ink"],
    CANCELLED: ["Cancelled", "danger"]
};

export const ElectionStatus = ({ election }) => {
    const [label, tone] = ELECTION_STATUS[election.status] || [election.status, "ink"];
    return <Badge tone={tone}>{label}</Badge>;
};

/** "Opens …", "Closes …" or "Closed …", depending on where the election is. */
export const electionTiming = (election) => {
    if (election.status === "SCHEDULED") return `Voting opens ${formatDateTime(election.opensAt)}`;
    if (election.status === "OPEN") return `Voting closes ${formatDateTime(election.closesAt)}`;
    if (election.status === "CLOSED") return `Closed ${timeAgo(election.closedAt || election.closesAt)}`;
    return `Cancelled ${timeAgo(election.cancelledAt)}`;
};

export const Turnout = ({ election }) => {
    if (election.status === "SCHEDULED" || !election.eligibleCount) return null;
    const share = Math.round((election.votesCast / election.eligibleCount) * 100);
    return (
        <div className="election-turnout" aria-label={`${election.votesCast} of ${election.eligibleCount} members voted`}>
            <div className="election-turnout-bar">
                <span style={{ width: `${Math.min(100, share)}%` }} />
            </div>
            <span className="small subtle">
                {election.votesCast} of {election.eligibleCount} voted · {share}%
            </span>
        </div>
    );
};

const CandidateFace = ({ candidate, children }) => (
    <span className="election-candidate-face">
        <Avatar name={candidate.user?.name} src={candidate.user?.avatar} size="sm" />
        <span className="stack-xs">
            <strong>{candidate.user?.name || "Former member"}</strong>
            {candidate.statement && <span className="small muted">{candidate.statement}</span>}
            {!candidate.stillMember && <span className="small subtle">Has left the club</span>}
            {children}
        </span>
    </span>
);

/** The secret ballot: pick one candidate, confirm, done (votes are final). */
export const Ballot = ({ election, onVoted }) => {
    const toast = useToast();
    const [choice, setChoice] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState(null);
    const chosen = election.candidates.find((candidate) => candidate.user?._id === choice);

    const cast = async () => {
        setError(null);
        try {
            const response = await electionApi.vote(election._id, choice);
            toast.success("Your vote has been counted");
            onVoted?.(response.data);
        } catch (err) {
            setError(err);
            throw err;
        }
    };

    return (
        <div className="stack">
            <fieldset className="election-ballot">
                <legend className="sr-only">Choose a candidate</legend>
                {election.candidates.map((candidate) => (
                    <label
                        key={candidate.user?._id}
                        className={`election-option ${choice === candidate.user?._id ? "is-chosen" : ""} ${candidate.stillMember ? "" : "is-disabled"}`}
                    >
                        <input
                            type="radio"
                            name={`ballot-${election._id}`}
                            value={candidate.user?._id}
                            checked={choice === candidate.user?._id}
                            disabled={!candidate.stillMember}
                            onChange={() => setChoice(candidate.user?._id)}
                        />
                        <CandidateFace candidate={candidate} />
                        <span className="election-radio" aria-hidden="true">
                            {choice === candidate.user?._id && <Check size={14} strokeWidth={3} />}
                        </span>
                    </label>
                ))}
            </fieldset>
            <ApiErrorAlert error={error} />
            <Button onClick={() => setConfirming(true)} disabled={!choice} block>
                <Vote size={16} /> Cast secret vote
            </Button>
            <p className="small subtle election-privacy">
                <Lock size={13} /> Your vote is secret. CampusConnect records only that you voted, never who you chose. Votes are final.
            </p>
            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={cast}
                title={`Vote for ${chosen?.user?.name || "this candidate"}?`}
                description="You can't change your vote afterwards. Nobody will see who you voted for."
                confirmLabel="Cast vote"
            />
        </div>
    );
};

/** Counts per candidate once voting has closed. */
export const Results = ({ election }) => {
    const total = election.votesCast || 0;
    return (
        <div className="stack">
            {election.result?.noVotes ? (
                <p className="muted" style={{ margin: 0 }}>
                    No votes were cast.
                </p>
            ) : (
                election.result?.tie && (
                    <p className="small election-note" style={{ margin: 0 }}>
                        It's a tie. The organiser can hold a runoff between the tied candidates.
                    </p>
                )
            )}
            <ol className="election-results">
                {election.candidates.map((candidate) => {
                    const share = total ? Math.round((candidate.votes / total) * 100) : 0;
                    return (
                        <li key={candidate.user?._id} className={candidate.leading ? "is-leading" : ""}>
                            <CandidateFace candidate={candidate}>
                                <span className="election-result-bar">
                                    <span style={{ width: `${share}%` }} />
                                </span>
                            </CandidateFace>
                            <span className="election-result-count">
                                {candidate.leading && !election.result?.tie && <Crown size={15} aria-label="Most votes" />}
                                <strong>{candidate.votes}</strong>
                                <span className="small subtle">{share}%</span>
                            </span>
                        </li>
                    );
                })}
            </ol>
            <p className="small subtle" style={{ margin: 0 }}>
                <ShieldCheck size={13} /> The result guides the club; the president makes the appointment.
            </p>
        </div>
    );
};

/** A compact card for lists and the club chat. */
export const ElectionSummary = ({ election, to }) => {
    const action = election.viewer?.canVote ? "Vote now" : election.status === "CLOSED" ? "See results" : "Open";
    return (
        <div className={`election-summary is-${election.status.toLowerCase()}`}>
            <div className="election-summary-head">
                <span className="election-icon" aria-hidden="true">
                    <Vote size={18} />
                </span>
                <div className="grow stack-xs">
                    <strong>{election.title}</strong>
                    <span className="small muted">
                        For {election.roleName} · {election.candidates.length} candidates
                    </span>
                </div>
                <ElectionStatus election={election} />
            </div>
            <span className="small subtle row" style={{ gap: 6 }}>
                <Clock size={13} /> {electionTiming(election)}
            </span>
            <Turnout election={election} />
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                {election.viewer?.hasVoted ? (
                    <span className="small election-voted">
                        <Check size={14} /> You voted
                    </span>
                ) : (
                    <span />
                )}
                {to && (
                    <Link to={to} className={`btn btn-sm ${election.viewer?.canVote ? "btn-primary" : "btn-secondary"}`}>
                        {action}
                    </Link>
                )}
            </div>
        </div>
    );
};
