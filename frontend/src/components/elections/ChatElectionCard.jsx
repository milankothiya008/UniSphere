import { useEffect, useState } from "react";
import { electionApi } from "../../api/endpoints";
import { useChat } from "../../context/ChatContext";
import { ElectionSummary } from "./ElectionParts";

/** An election posted in the club group: live status, turnout and a button to vote or see the result. */
export const ChatElectionCard = ({ message }) => {
    const { on } = useChat();
    const [election, setElection] = useState(null);
    const [missing, setMissing] = useState(false);
    const id = String(message.poll || "");

    useEffect(() => {
        if (!id) return undefined;
        let active = true;
        const load = () =>
            electionApi
                .get(id)
                .then((response) => active && setElection(response.data))
                .catch(() => active && setMissing(true));
        load();
        const off = on?.("election:updated", ({ electionId }) => electionId === id && load());
        return () => {
            active = false;
            off?.();
        };
    }, [id, on]);

    return (
        <div className="msg-election" id={`m-${message._id}`}>
            <span className="small subtle">{message.sender?.name || "Someone"} started an election</span>
            {election ? (
                <ElectionSummary election={election} to={`/clubs/${election.club}/elections/${election._id}`} />
            ) : (
                <div className="election-summary">
                    <strong>{message.text}</strong>
                    <span className="small subtle">{missing ? "This election is no longer available." : "Loading…"}</span>
                </div>
            )}
        </div>
    );
};
