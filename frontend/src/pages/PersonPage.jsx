import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Award, BadgeCheck, CalendarCheck2, FileBadge, GraduationCap, Lock, Phone, Users } from "lucide-react";
import { userApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { AsyncContent, Avatar, Badge, EmptyState, RoleBadge, Skeleton, StatStrip, Tabs } from "../components/ui";
import { ROLE_LABELS } from "../lib/constants";
import { batchLabel, formatDate, humanize } from "../lib/format";
import { formatPhone } from "../lib/phone";

const ClubTile = ({ club, role, roleName, index }) => (
    <Link to={`/clubs/${club._id}`} className="person-club" style={{ "--i": Math.min(index, 10) }}>
        <Avatar name={club.name} src={club.logo} square />
        <span className="person-club-body">
            <strong>{club.name}</strong>
            <span className="subtle small">{humanize(club.category)}</span>
        </span>
        {role ? <RoleBadge role={role} label={roleName} /> : <span className="person-club-tag">Mentor</span>}
    </Link>
);

const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

const EventsList = ({ events }) =>
    events.length ? (
        <ul className="history-list">
            {events.map((row, index) => (
                <li key={row._id} style={{ "--i": Math.min(index, 10) }}>
                    <Link to={`/events/${row._id}`} className="history-row">
                        <span className="history-icon">
                            <CalendarCheck2 size={18} />
                        </span>
                        <span className="history-body">
                            <strong>{row.title}</strong>
                            <span className="subtle small">
                                {[row.club, row.category, formatDate(row.startAt), row.team && `Team ${row.team}`].filter(Boolean).join(" · ")}
                            </span>
                        </span>
                        {row.attendance === "Attended" && (
                            <Badge tone="success">
                                <BadgeCheck size={12} /> Attended
                            </Badge>
                        )}
                    </Link>
                </li>
            ))}
        </ul>
    ) : (
        <EmptyState icon={CalendarCheck2} title="No past events yet" description="Events they take part in show up here once they're over." />
    );

const AwardsList = ({ awards }) =>
    awards.length ? (
        <ul className="history-list">
            {awards.map((award, index) => (
                <li key={`${award.event}-${award.title}-${index}`} style={{ "--i": Math.min(index, 10) }}>
                    <Link to={award.eventId ? `/results/${award.eventId}` : "#"} className="history-row">
                        <span className={`medal medal-${award.position || 0}`}>{award.position || "★"}</span>
                        <span className="history-body">
                            <strong>
                                {award.title}
                                {award.position ? <span className="subtle"> · {ordinal(award.position)} place</span> : null}
                            </strong>
                            <span className="subtle small">
                                {[award.event, award.club, award.team && `Team ${award.team}`, award.date && formatDate(award.date)]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </span>
                        </span>
                    </Link>
                </li>
            ))}
        </ul>
    ) : (
        <EmptyState icon={Award} title="No awards yet" description="Wins and recognitions from published results appear here." />
    );

const CertificatesList = ({ certificates }) =>
    certificates.length ? (
        <ul className="history-list">
            {certificates.map((row, index) => (
                <li key={row.code} style={{ "--i": Math.min(index, 10) }}>
                    <Link to={`/verify/${row.code}`} className="history-row">
                        <span className="history-icon is-gold">
                            <FileBadge size={18} />
                        </span>
                        <span className="history-body">
                            <strong>{row.kind === "MERIT" ? `${row.awardTitle || "Merit"} — ${row.eventTitle}` : `Participation — ${row.eventTitle}`}</strong>
                            <span className="subtle small">
                                {[row.clubName, row.eventStartAt && formatDate(row.eventStartAt), `Code ${row.code}`].filter(Boolean).join(" · ")}
                            </span>
                        </span>
                        <span className="history-verify">Verify</span>
                    </Link>
                </li>
            ))}
        </ul>
    ) : (
        <EmptyState icon={FileBadge} title="No certificates yet" description="Certificates from events appear here, each with a link anyone can verify." />
    );

/**
 * Someone else's profile, like a public Instagram profile: who they are, their clubs, and what they've done —
 * past events, awards and certificates. Their email and upcoming schedule stay private; the mobile number
 * shows only to the people allowed to see it.
 */
const PersonPage = () => {
    const { id } = useParams();
    const { data: person, loading, error, reload } = useApi(() => userApi.profile(id), [id]);
    const [tab, setTab] = useState("clubs");

    if (person?.isSelf) {
        return <Navigate to="/profile" replace />;
    }

    const faculty = person?.globalRole === "FACULTY";
    const tiles = faculty ? (person?.mentoredClubs || []).map((club) => ({ club })) : person?.clubs || [];
    const history = person?.history;
    const stats = [{ label: faculty ? (tiles.length === 1 ? "mentored club" : "mentored clubs") : tiles.length === 1 ? "club" : "clubs", value: tiles.length }];
    if (history) {
        stats.push({ label: history.events.length === 1 ? "event" : "events", value: history.events.length });
        stats.push({ label: history.awards.length === 1 ? "award" : "awards", value: history.awards.length });
    }

    const tabs = history
        ? [
              { value: "clubs", label: "Clubs", icon: Users, count: tiles.length },
              { value: "events", label: "Events", icon: CalendarCheck2, count: history.events.length },
              { value: "awards", label: "Achievements", icon: Award, count: history.awards.length },
              { value: "certificates", label: "Certificates", icon: FileBadge, count: history.certificates.length }
          ]
        : null;

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload} skeleton={<Skeleton height={180} style={{ borderRadius: 12 }} />}>
            {person && (
                <div className="profile">
                    <section className="profile-head">
                        <Avatar name={person.name} src={person.avatar} size="xl" />
                        <div className="profile-head-main">
                            <div className="profile-name-row">
                                <h1>{person.name}</h1>
                            </div>
                            <StatStrip items={stats} />
                            <p className="profile-bio">
                                <span>
                                    <strong>{ROLE_LABELS[person.globalRole]}</strong>
                                    {[person.departmentCode, person.batchCode && `Batch ${batchLabel(person.batchCode)}`]
                                        .filter(Boolean)
                                        .map((part) => ` · ${part}`)}
                                </span>
                                {person.phone ? (
                                    <a href={`tel:${person.phone}`} className="person-phone">
                                        <Phone size={13} /> {formatPhone(person.phone)}
                                    </a>
                                ) : (
                                    <span className="person-private">
                                        <Lock size={12} /> Contact details and upcoming schedule are private
                                    </span>
                                )}
                            </p>
                        </div>
                    </section>

                    {tabs && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

                    {(!tabs || tab === "clubs") && (
                        <section className="stack">
                            {!tabs && <h2 className="person-heading">{faculty ? "Mentors" : "Clubs"}</h2>}
                            {tiles.length ? (
                                <div className="person-clubs">
                                    {tiles.map((tile, index) => (
                                        <ClubTile key={tile.club._id} index={index} {...tile} />
                                    ))}
                                </div>
                            ) : (
                                <EmptyState icon={faculty ? GraduationCap : Users} title={faculty ? "Not mentoring a club yet" : "Not in a club yet"} />
                            )}
                        </section>
                    )}
                    {tabs && tab === "events" && <EventsList events={history.events} />}
                    {tabs && tab === "awards" && <AwardsList awards={history.awards} />}
                    {tabs && tab === "certificates" && <CertificatesList certificates={history.certificates} />}
                </div>
            )}
        </AsyncContent>
    );
};

export default PersonPage;
