import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { dashboardApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { AsyncContent, Avatar, ButtonLink, Card, EmptyState, Skeleton, StatStrip, StatusBadge } from "../components/ui";
import { StudentProfile } from "../components/profile/StudentProfile";
import { ROLE_LABELS } from "../lib/constants";
import { batchLabel } from "../lib/format";

const ProfileHead = ({ user, stats }) => (
    <section className="profile-head">
        <Avatar name={user.name} size="xl" />
        <div className="profile-head-main">
            <div className="profile-name-row">
                <h1>{user.name}</h1>
                <ButtonLink to="/settings" variant="secondary" size="sm">
                    Edit profile
                </ButtonLink>
            </div>
            {stats && <StatStrip items={stats} />}
            <p className="profile-bio">
                <span>
                    <strong>{ROLE_LABELS[user.globalRole]}</strong>
                    {[user.departmentCode, user.batchCode && `Batch ${batchLabel(user.batchCode)}`].filter(Boolean).map((part) => ` · ${part}`)}
                </span>
                <span className="subtle">{user.email}</span>
            </p>
        </div>
    </section>
);

const MentoredClubs = ({ clubs }) => (
    <Card title="Mentored clubs" padded={false}>
        {clubs.length ? (
            <div className="list-rows">
                {clubs.map((club) => (
                    <Link key={club._id} to={`/clubs/${club._id}`} className="list-row">
                        <Avatar name={club.name} src={club.logo} size="sm" square />
                        <span className="grow title">{club.name}</span>
                        <StatusBadge status={club.status} />
                    </Link>
                ))}
            </div>
        ) : (
            <EmptyState icon={GraduationCap} title="No mentored clubs yet" />
        )}
    </Card>
);

// Instagram-style profile. Students also get their schedule, applications, clubs and Club HQ here.
const ProfilePage = () => {
    const { user, isStudent, isFaculty } = useAuth();
    const { mentoredClubs } = useWorkspace();
    const { data, loading, error, reload } = useApi(() => dashboardApi.get(), [], { enabled: isStudent });
    const student = data?.student;

    const stats = isStudent
        ? student && [
              { label: "upcoming", value: student.upcomingRegistrations.length, to: "/my-registrations" },
              { label: "attended", value: student.stats.attended, to: "/my-registrations?timeframe=past" },
              { label: student.stats.clubs === 1 ? "club" : "clubs", value: student.stats.clubs, to: "/clubs?view=mine" }
          ]
        : isFaculty
          ? [{ label: mentoredClubs.length === 1 ? "mentored club" : "mentored clubs", value: mentoredClubs.length, to: "/faculty/clubs" }]
          : null;

    return (
        <div className="profile">
            <ProfileHead user={user} stats={stats} />
            {isStudent && (
                <AsyncContent loading={loading} error={error} onRetry={reload} skeleton={<Skeleton height={320} style={{ borderRadius: 12 }} />}>
                    {student && <StudentProfile data={data} />}
                </AsyncContent>
            )}
            {isFaculty && <MentoredClubs clubs={mentoredClubs} />}
        </div>
    );
};

export default ProfilePage;
