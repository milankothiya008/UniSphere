import { useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { CalendarDays, Clock, Gift, Info, Link2, Lock, LogOut, Megaphone, Settings, UserPlus, Users } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Alert, AsyncContent, ButtonLink, ConfirmDialog, RoleBadge, StatStrip, StatusBadge, Tabs } from "../../components/ui";
import { departmentsLabel, formatDate, humanize } from "../../lib/format";
import { APPLICATION_STATUSES, PERMISSIONS } from "../../lib/constants";
import { belongsToScope } from "../../lib/eligibility";
import { ClubSocialRow } from "../../components/clubs/ClubConnect";
import { FollowButton } from "../../components/clubs/NotifyBell";
import { ClubStoryAvatar } from "../../components/stories/ClubStoryAvatar";

const ClubLayout = () => {
    const { id } = useParams();
    const { user, isStudent } = useAuth();
    const { reloadClubs } = useWorkspace();
    const toast = useToast();
    const { data: club, loading, error, reload } = useApi(() => clubApi.get(id), [id]);
    const [leaving, setLeaving] = useState(false);
    const [followers, setFollowers] = useState(null);

    const refresh = () => {
        reload({ silent: true });
        reloadClubs();
    };

    const leave = async () => {
        await clubApi.leave(id);
        toast.success(`You left ${club.name}`);
        refresh();
    };

    const viewer = club?.viewer || {};
    const can = (permission) => viewer.permissions?.includes(permission);
    const canSeeMembers = viewer.isMember || viewer.isMentor || Boolean(viewer.canSeeMembers);
    const canSettings = can(PERMISSIONS.MANAGE_CLUB) || viewer.isMentor || viewer.isAdmin;

    const tabs = [
        { to: `/clubs/${id}`, label: "About", icon: Info, end: true },
        { to: `/clubs/${id}/events`, label: "Events", icon: CalendarDays, count: club?.upcomingEvents || null },
        ...(club?.status === "ACTIVE" ? [{ to: `/clubs/${id}/recruitment`, label: club?.recruiting ? "Recruitment · open" : "Recruitment", icon: Megaphone }] : []),
        ...(canSeeMembers ? [{ to: `/clubs/${id}/members`, label: "Members", icon: Users, count: club?.memberCount }] : []),
        ...(canSettings ? [{ to: `/clubs/${id}/settings`, label: viewer.isAdmin && !viewer.isMember ? "Administration" : "Manage", icon: Settings }] : [])
    ];

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {club && (
                <div className="stack-lg">
                    <section className="club-head">
                        <div className="club-head-avatar">
                            <ClubStoryAvatar club={club} />
                        </div>
                        <div className="club-head-main">
                            <div className="club-head-title">
                                <h1>{club.name}</h1>
                                {club.status !== "ACTIVE" && <StatusBadge status={club.status} />}
                                {viewer.role && <RoleBadge role={viewer.role} label={viewer.roleName} />}
                            </div>
                            <StatStrip
                                items={[
                                    { label: "upcoming", value: club.upcomingEvents ?? 0, to: `/clubs/${id}/events` },
                                    { label: club.memberCount === 1 ? "member" : "members", value: club.memberCount ?? 0, to: canSeeMembers ? `/clubs/${id}/members` : undefined },
                                    ...(typeof club.followerCount === "number" ? [{ label: (followers ?? club.followerCount) === 1 ? "follower" : "followers", value: followers ?? club.followerCount }] : [])
                                ]}
                            />
                            <div className="club-head-bio">
                                <strong>
                                    {humanize(club.category)} · {departmentsLabel(club)}
                                </strong>
                                {club.tagline && <span>{club.tagline}</span>}
                                {(club.president || club.mentor) && (
                                    <span className="subtle">{[club.president && `President ${club.president.name}`, club.mentor && `Mentor ${club.mentor.name}`].filter(Boolean).join(" · ")}</span>
                                )}
                                <ClubSocialRow club={club} />
                            </div>
                            <div className="club-head-actions">
                                {user && <FollowButton club={club} showCount={false} onFollowersChange={setFollowers} />}
                                {/* Students join through recruitment drives. */}
                                {isStudent && club.status === "ACTIVE" && !viewer.isMember &&
                                    (!belongsToScope(user, club) ? (
                                        <span className="hero-note">
                                            <Lock size={14} /> Only for {departmentsLabel(club)} students
                                        </span>
                                    ) : viewer.applications?.some((application) => application.status === "OFFERED") ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}?offer=1`} variant="accent">
                                            <Gift size={16} /> Respond to offer
                                        </ButtonLink>
                                    ) : viewer.applications?.length ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}`} variant="secondary">
                                            <Clock size={16} />{" "}
                                            {viewer.applications.length === 1
                                                ? APPLICATION_STATUSES[viewer.applications[0].status]?.[0] || "Applied"
                                                : `Applied for ${viewer.applications.length} roles`}
                                        </ButtonLink>
                                    ) : club.recruiting?.open ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}`}>
                                            <UserPlus size={16} /> Apply · until {formatDate(club.recruiting.applicationEnd)}
                                        </ButtonLink>
                                    ) : club.recruiting ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}`} variant="secondary">
                                            <Megaphone size={16} /> Opens {formatDate(club.recruiting.applicationStart)}
                                        </ButtonLink>
                                    ) : null)}
                                <ActionMenu
                                    label="Club options"
                                    items={[
                                        { label: "Copy link", icon: Link2, onClick: () => navigator.clipboard?.writeText(window.location.href).then(() => toast.success("Link copied")) },
                                        { label: "Leave club", icon: LogOut, danger: true, hidden: !(viewer.isMember && viewer.role !== "PRESIDENT"), onClick: () => setLeaving(true) }
                                    ]}
                                />
                            </div>
                        </div>
                    </section>

                    {club.status === "APPROVED" && viewer.isAdmin && !viewer.isMentor && (
                        <Alert type="info" title="Waiting for a president">
                            The club's faculty mentor ({club.mentor?.name || "not assigned"}) appoints the president to activate the club.
                        </Alert>
                    )}
                    {club.status === "APPROVED" && viewer.isMentor && (
                        <Alert type="warning" title="This club needs a president">
                            Appoint a student president from the Manage tab to activate the club.
                        </Alert>
                    )}
                    {club.status === "APPROVED" && viewer.isMember && !viewer.isMentor && (
                        <Alert type="info" title="Club approved">
                            Your faculty mentor will appoint the president to activate the club.
                        </Alert>
                    )}
                    {["SUSPENDED", "ARCHIVED"].includes(club.status) && (
                        <Alert type="error" title={club.status === "SUSPENDED" ? "This club is suspended" : "This club is archived"}>
                            Its upcoming events and recruitment are on hold — students can't see them, register or apply until the university reactivates the club.
                            {club.statusNote && (
                                <>
                                    {" "}
                                    Reason: &ldquo;{club.statusNote}&rdquo;
                                </>
                            )}
                        </Alert>
                    )}

                    <Tabs tabs={tabs} />
                    <Outlet context={{ club, reload: refresh }} />

                    <ConfirmDialog
                        open={leaving}
                        onClose={() => setLeaving(false)}
                        onConfirm={leave}
                        title={`Leave ${club.name}?`}
                        description={`You'll lose access to member-only posts${viewer.roleName && viewer.role !== "MEMBER" ? ` and your role as ${viewer.roleName}` : ""}.`}
                        confirmLabel="Leave club"
                        variant="danger"
                    />
                </div>
            )}
        </AsyncContent>
    );
};

export default ClubLayout;
