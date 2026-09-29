import { Link } from "react-router-dom";
import { CalendarClock, ChevronRight, Gift } from "lucide-react";
import { Avatar } from "../ui";
import { ApplicationBadge } from "./RecruitmentParts";
import { formatDateTime, plural, timeAgo } from "../../lib/format";

/** One of the student's applications: the drive, their status and what's next. */
export const ApplicationRow = ({ application }) => (
    <Link to={`/recruitment/${application.drive._id}${application.status === "OFFERED" ? "?offer=1" : ""}`} className="recruit-my-row">
        <Avatar name={application.drive.club.name} src={application.drive.club.logo} size="md" square />
        <span className="grow">
            <strong>{application.positionTitle}</strong>
            <span className="subtle small">
                {application.drive.club.name} · {application.drive.title} · applied {timeAgo(application.createdAt)}
            </span>
            {application.status === "OFFERED" && (
                <span className="recruit-next is-good">
                    <Gift size={14} /> Offer — answer by {formatDateTime(application.offerExpiresAt)}
                </span>
            )}
            {application.nextInterview && (
                <span className="recruit-next">
                    <CalendarClock size={14} /> {application.nextInterview.name} · {formatDateTime(application.nextInterview.slot.startAt)}
                </span>
            )}
            {application.status === "ACCEPTED" && <span className="recruit-next is-good">Joined as {application.positionTitle}</span>}
            {application.status === "IN_ROUNDS" && !application.nextInterview && application.roundsPassed > 0 && (
                <span className="subtle small">Cleared {plural(application.roundsPassed, "round")} — waiting for the next step</span>
            )}
        </span>
        <ApplicationBadge status={application.status} />
        <ChevronRight size={16} className="subtle" />
    </Link>
);
