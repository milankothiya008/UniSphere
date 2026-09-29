import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, CalendarClock, CheckCircle2, Clock, Flag, Gift, LogIn, Megaphone, Mic, Users } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { Avatar, ButtonLink, Card, Skeleton } from "../ui";
import { FollowButton } from "../clubs/NotifyBell";
import { ApplicationBadge } from "./RecruitmentParts";
import { departmentsLabel, formatDate, formatDateTime, formatTime, humanize, plural } from "../../lib/format";
import { cssImage } from "../../lib/images";

// ---------------------------------------------------------------- Key dates

// The drive's dates in order, done or still ahead, with the interviews that are scheduled.
const datesOf = (drive, staff) => {
    const now = Date.now();
    const dates = [];
    if (drive.publishedAt) dates.push({ key: "published", icon: Megaphone, label: "Published", at: drive.publishedAt });
    dates.push({ key: "open", icon: CalendarCheck, label: "Applications open", at: drive.applicationStart });
    dates.push({ key: "close", icon: Clock, label: drive.closedAt ? "Applications closed" : "Applications close", at: drive.closedAt || drive.applicationEnd });
    if (staff) {
        drive.positions.forEach((position) =>
            position.rounds
                .filter((round) => round.startAt && round.mode !== "SCREENING")
                .forEach((round) => dates.push({ key: `${position._id}-${round._id}`, icon: Mic, label: `${round.name} · ${position.title}`, at: round.startAt, time: true }))
        );
    }
    if (drive.completedAt) dates.push({ key: "done", icon: Flag, label: "Recruitment completed", at: drive.completedAt });
    return dates
        .filter((date) => date.at)
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .map((date) => ({ ...date, past: new Date(date.at).getTime() <= now }));
};

const KeyDates = ({ drive, staff }) => {
    const dates = datesOf(drive, staff);
    const next = dates.findIndex((date) => !date.past);
    return (
        <Card title={<h2 className="row"><CalendarClock size={17} /> Key dates</h2>}>
            <ol className="side-dates">
                {dates.map((date, index) => {
                    const Icon = date.past ? CheckCircle2 : date.icon;
                    return (
                        <li key={date.key} className={date.past ? "is-past" : index === next ? "is-next" : ""} style={{ "--i": index }}>
                            <span className="side-dates-dot">
                                <Icon size={14} />
                            </span>
                            <span className="side-dates-text">
                                <strong>{date.label}</strong>
                                <span>{date.time ? `${formatDate(date.at)} · ${formatTime(date.at)}` : formatDateTime(date.at)}</span>
                            </span>
                        </li>
                    );
                })}
            </ol>
        </Card>
    );
};

// ---------------------------------------------------------------- Club

const ClubCard = ({ clubId }) => {
    const { data: club, loading } = useApi(() => clubApi.get(clubId), [clubId]);
    if (loading && !club) {
        return <Skeleton height={190} style={{ borderRadius: 18 }} />;
    }
    if (!club) {
        return null;
    }
    return (
        <section className="side-club">
            <div className="side-club-cover" style={club.coverImage ? { "--cover": cssImage(club.coverImage, 400) } : undefined} />
            <div className="side-club-body">
                <Avatar name={club.name} src={club.logo} size="lg" square />
                <Link to={`/clubs/${club._id}`} className="side-club-name">
                    {club.name}
                </Link>
                {club.tagline && <p className="subtle small">{club.tagline}</p>}
                <div className="side-club-facts">
                    <span>
                        <Users size={13} /> {plural(club.memberCount, "member")}
                    </span>
                    <span>{humanize(club.category)}</span>
                    <span>{departmentsLabel(club)}</span>
                </div>
                <div className="side-club-actions">
                    <FollowButton club={club} className="is-light" />
                    <Link to={`/clubs/${club._id}`} className="side-link">
                        Club page <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </section>
    );
};

// ---------------------------------------------------------------- The student's standing

const MyStanding = ({ drive, mine, onOpen }) => {
    const offer = mine.find((application) => application.status === "OFFERED");
    const joined = mine.find((application) => application.status === "ACCEPTED");
    return (
        <Card title={joined ? "You're in! 🎉" : offer ? "You have an offer" : "Your applications"} className={`side-standing ${offer ? "is-offer" : ""} ${joined ? "is-joined" : ""}`}>
            <ul className="side-standing-list">
                {mine.map((application) => (
                    <li key={application._id}>
                        <button type="button" onClick={() => onOpen(application._id)}>
                            <span className="grow">{application.positionTitle}</span>
                            {application.status === "WITHDRAWN" && application.closedReason ? <span className="subtle small">Closed</span> : <ApplicationBadge status={application.status} />}
                        </button>
                    </li>
                ))}
            </ul>
            {offer && (
                <button type="button" className="btn btn-accent btn-block" onClick={() => onOpen(offer._id)}>
                    <Gift size={16} /> Answer by {formatDate(offer.offerExpiresAt)}
                </button>
            )}
            {!offer && !joined && drive.viewer?.canApply && drive.positions.length > mine.length && (
                <a className="side-link" href="#roles">
                    Apply for another role <ArrowRight size={14} />
                </a>
            )}
        </Card>
    );
};

/**
 * The drive page's side column: what to do next, the key dates and the club behind the drive. Sticky on
 * wide screens so it stays in view while the main column scrolls.
 */
export const DriveSidebar = ({ drive, staff, user, mine, actions, onOpenApplication }) => (
    <aside className="drive-side">
        {actions}
        {/* The full list is in the main column; the side only calls out an offer or a place in the team. */}
        {!staff && mine.some((application) => ["OFFERED", "ACCEPTED"].includes(application.status)) && <MyStanding drive={drive} mine={mine} onOpen={onOpenApplication} />}
        {!user && (
            <Card className="side-signin">
                <p style={{ margin: "0 0 12px" }}>Sign in with your university account to apply for a role.</p>
                <ButtonLink to="/login" block>
                    <LogIn size={16} /> Sign in to apply
                </ButtonLink>
            </Card>
        )}
        <KeyDates drive={drive} staff={staff} />
        {!staff && <ClubCard clubId={drive.club._id} />}
    </aside>
);
