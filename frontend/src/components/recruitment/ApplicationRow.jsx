import { Link } from "react-router-dom";
import { CalendarClock, ChevronRight } from "lucide-react";
import { Avatar } from "../ui";
import { ApplicationBadge, roleName } from "./RecruitmentParts";
import { formatDateTime, plural, timeAgo } from "../../lib/format";

/** One of the student's applications: the drive, their status and what's next. */
export const ApplicationRow = ({ application }) => (
    <Link to={`/recruitment/${application.drive._id}`} className="recruit-my-row">
        <Avatar name={application.drive.club.name} src={application.drive.club.logo} size="md" square />
        <span className="grow">
            <strong>{application.drive.title}</strong>
            <span className="subtle small">
                {application.drive.club.name} · {application.positionTitles.join(", ")} · applied {timeAgo(application.createdAt)}
            </span>
            {application.nextInterview && (
                <span className="recruit-next">
                    <CalendarClock size={14} /> {application.nextInterview.name} · {formatDateTime(application.nextInterview.slot.startAt)}
                </span>
            )}
            {application.status === "SELECTED" && <span className="recruit-next is-good">Joined as {roleName(application.finalRole)}</span>}
            {application.status === "IN_ROUNDS" && !application.nextInterview && application.roundsPassed > 0 && (
                <span className="subtle small">Cleared {plural(application.roundsPassed, "round")} — waiting for the next step</span>
            )}
        </span>
        <ApplicationBadge status={application.status} />
        <ChevronRight size={16} className="subtle" />
    </Link>
);
