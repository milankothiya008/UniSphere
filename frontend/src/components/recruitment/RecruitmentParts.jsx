import { Check, Clock, Hourglass } from "lucide-react";
import { Badge } from "../ui";
import { APPLICATION_STATUSES, RECRUITMENT_PHASES } from "../../lib/constants";
import { countdownParts, formatDateTime, humanize } from "../../lib/format";

export const PhaseBadge = ({ phase }) => {
    const [label, tone] = RECRUITMENT_PHASES[phase] || [humanize(phase), "neutral"];
    return (
        <Badge tone={tone} dot>
            {label}
        </Badge>
    );
};

export const ApplicationBadge = ({ status }) => {
    const [label, tone] = APPLICATION_STATUSES[status] || [humanize(status), "neutral"];
    return (
        <Badge tone={tone} dot>
            {label}
        </Badge>
    );
};

// Where the drive is in its life, for the president and the mentor.
const STEPS = [
    { key: "DRAFT", label: "Draft" },
    { key: "PENDING_APPROVAL", label: "Mentor review" },
    { key: "APPROVED", label: "Approved" },
    { key: "OPEN", label: "Applications" },
    { key: "ROUNDS", label: "Rounds" },
    { key: "COMPLETED", label: "Completed" }
];
const STEP_OF = { DRAFT: 0, NEEDS_CHANGES: 0, PENDING_APPROVAL: 1, APPROVED: 2, UPCOMING: 3, OPEN: 3, CLOSED: 4, ROUNDS: 4, COMPLETED: 5 };

export const DriveStepper = ({ phase }) => {
    const index = STEP_OF[phase];
    if (index === undefined) {
        return null;
    }
    return (
        <ol className="workflow recruit-workflow" aria-label="Recruitment progress">
            {STEPS.map((step, i) => (
                <li key={step.key} className={`step ${i < index ? "done" : i === index ? "current" : ""}`} aria-current={i === index ? "step" : undefined}>
                    <span className="step-dot">{i < index ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                    <span className="step-label">{step.label}</span>
                </li>
            ))}
        </ol>
    );
};

/** "Closes in 2 days 5 hrs" while applications are open, the deadline otherwise. */
export const Deadline = ({ drive }) => {
    if (drive.phase === "OPEN") {
        const parts = countdownParts(new Date(drive.applicationEnd) - Date.now());
        return (
            <span className="recruit-deadline is-open" title={formatDateTime(drive.applicationEnd)}>
                <Hourglass size={14} /> Closes in {parts.map(([value, unit]) => `${value} ${unit}`).join(" ")}
            </span>
        );
    }
    if (drive.phase === "UPCOMING") {
        return (
            <span className="recruit-deadline">
                <Clock size={14} /> Opens {formatDateTime(drive.applicationStart)}
            </span>
        );
    }
    return (
        <span className="recruit-deadline">
            <Clock size={14} /> Applications closed {formatDateTime(drive.closedAt || drive.applicationEnd)}
        </span>
    );
};

export const PositionChips = ({ positions }) => (
    <div className="recruit-chips">
        {positions.map((position) => (
            <span key={position._id || position} className="recruit-chip">
                {position.title || position}
                {position.openings ? <small>{position.openings} open</small> : null}
            </span>
        ))}
    </div>
);
