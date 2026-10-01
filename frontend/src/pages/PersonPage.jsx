import { Link, Navigate, useParams } from "react-router-dom";
import { GraduationCap, Lock, Users } from "lucide-react";
import { userApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { AsyncContent, Avatar, EmptyState, RoleBadge, Skeleton, StatStrip } from "../components/ui";
import { ROLE_LABELS } from "../lib/constants";
import { batchLabel, humanize } from "../lib/format";

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

/**
 * Someone else's profile, like a public Instagram profile: who they are and the clubs they're part of.
 * Their email, mobile number, event schedule and applications stay private — only they see those,
 * on their own profile.
 */
const PersonPage = () => {
    const { id } = useParams();
    const { data: person, loading, error, reload } = useApi(() => userApi.profile(id), [id]);

    if (person?.isSelf) {
        return <Navigate to="/profile" replace />;
    }

    const faculty = person?.globalRole === "FACULTY";
    const tiles = faculty ? (person?.mentoredClubs || []).map((club) => ({ club })) : person?.clubs || [];

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload} skeleton={<Skeleton height={180} style={{ borderRadius: 12 }} />}>
            {person && (
                <div className="profile">
                    <section className="profile-head">
                        <Avatar name={person.name} size="xl" />
                        <div className="profile-head-main">
                            <div className="profile-name-row">
                                <h1>{person.name}</h1>
                            </div>
                            <StatStrip items={[{ label: faculty ? (tiles.length === 1 ? "mentored club" : "mentored clubs") : tiles.length === 1 ? "club" : "clubs", value: tiles.length }]} />
                            <p className="profile-bio">
                                <span>
                                    <strong>{ROLE_LABELS[person.globalRole]}</strong>
                                    {[person.departmentCode, person.batchCode && `Batch ${batchLabel(person.batchCode)}`].filter(Boolean).map((part) => ` · ${part}`)}
                                </span>
                                <span className="person-private">
                                    <Lock size={12} /> Contact details and event schedule are private
                                </span>
                            </p>
                        </div>
                    </section>

                    <section className="stack">
                        <h2 className="person-heading">{faculty ? "Mentors" : "Clubs"}</h2>
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
                </div>
            )}
        </AsyncContent>
    );
};

export default PersonPage;
