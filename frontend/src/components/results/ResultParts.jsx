import { CheckCircle2, Crown, Medal, XCircle } from "lucide-react";
import { Badge } from "../ui";

export const entryName = (entry) => entry.teamName || entry.recipientName || entry.recipientUser?.name || "—";

// The individual behind a team entry, when the row names both.
export const entryPerson = (entry) => {
    const person = entry.recipientUser?.name || entry.recipientName;
    return entry.teamName && person && person !== entry.teamName ? person : null;
};

export const QualifiedBadge = ({ qualified }) => {
    if (qualified === true) {
        return (
            <Badge tone="success">
                <CheckCircle2 size={12} /> Qualified
            </Badge>
        );
    }
    if (qualified === false) {
        return (
            <Badge tone="neutral">
                <XCircle size={12} /> Eliminated
            </Badge>
        );
    }
    return null;
};

const RankCell = ({ rank }) => (rank ? <span className={`medal medal-${rank <= 3 ? rank : 0}`}>{rank}</span> : <span className="subtle">—</span>);

// A round's standings. On narrow screens each row becomes a compact card (see .standings CSS).
export const Standings = ({ entries = [] }) => {
    if (!entries.length) {
        return <p className="subtle">No standings in this round yet.</p>;
    }
    const hasScore = entries.some((entry) => entry.score);
    const hasStatus = entries.some((entry) => entry.qualified !== null && entry.qualified !== undefined);

    return (
        <div className="standings" role="table" aria-label="Standings">
            <div className="standings-row standings-head" role="row">
                <span role="columnheader">Rank</span>
                <span role="columnheader">Participant / team</span>
                {hasScore && <span role="columnheader">Score</span>}
                {hasStatus && <span role="columnheader">Status</span>}
            </div>
            {entries.map((entry) => (
                <div key={entry._id || entryName(entry)} className={`standings-row ${entry.qualified === true ? "is-qualified" : ""}`} role="row">
                    <span role="cell" className="standings-rank">
                        <RankCell rank={entry.rank} />
                    </span>
                    <span role="cell" className="standings-name">
                        <strong>{entryName(entry)}</strong>
                        {entryPerson(entry) && <small className="subtle">{entryPerson(entry)}</small>}
                        {entry.note && <small className="standings-note">{entry.note}</small>}
                    </span>
                    {hasScore && (
                        <span role="cell" className="standings-score">
                            {entry.score || "—"}
                        </span>
                    )}
                    {hasStatus && (
                        <span role="cell" className="standings-status">
                            <QualifiedBadge qualified={entry.qualified} />
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
};

const byPosition = (awards) => [...awards].sort((a, b) => (a.position || 99) - (b.position || 99));

// Podium for the top three positions, then every other award as a list.
export const WinnersPodium = ({ awards = [] }) => {
    const sorted = byPosition(awards);
    const top = sorted.filter((award) => award.position && award.position <= 3);
    const rest = sorted.filter((award) => !top.includes(award));
    // Classic podium order: 2nd, 1st, 3rd.
    const stage = [2, 1, 3].map((position) => top.find((award) => award.position === position)).filter(Boolean);

    return (
        <div className="stack">
            {stage.length > 0 && (
                <div className="winners-podium">
                    {stage.map((award) => (
                        <div key={award._id || award.title} className={`podium-step place-${award.position}`}>
                            <div className="podium-person">
                                {award.position === 1 ? <Crown size={22} /> : <Medal size={20} />}
                                <strong>{award.teamName || award.recipientName || award.recipientUser?.name}</strong>
                                {award.teamName && (award.recipientUser?.name || award.recipientName) && award.teamName !== (award.recipientUser?.name || award.recipientName) && (
                                    <small>{award.recipientUser?.name || award.recipientName}</small>
                                )}
                                <span className="podium-title">{award.title}</span>
                                {award.prize && <span className="podium-prize">{award.prize}</span>}
                            </div>
                            <div className="podium-block">{award.position}</div>
                        </div>
                    ))}
                </div>
            )}
            {rest.length > 0 && (
                <div className="list-rows award-list">
                    {rest.map((award) => (
                        <div key={award._id || award.title} className="list-row">
                            <span className={`medal medal-${award.position && award.position <= 3 ? award.position : 0}`}>{award.position || "★"}</span>
                            <div className="grow">
                                <strong>{award.teamName || award.recipientName || award.recipientUser?.name}</strong>
                                <div className="subtle">
                                    {award.title}
                                    {award.recognition ? ` · ${award.recognition}` : ""}
                                </div>
                            </div>
                            {award.prize && <span className="subtle">{award.prize}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// "Final results" / "Round 2 results · live" chip for cards and headers.
export const ResultStage = ({ final, latestRound }) =>
    final ? (
        <Badge tone="gold">
            <Crown size={12} /> Final results
        </Badge>
    ) : (
        <span className="live-chip">
            <span className="live-dot" /> {latestRound ? `${latestRound} results` : "Round results"}
        </span>
    );
