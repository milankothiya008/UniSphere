import { useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { CalendarDays, GraduationCap, Info, Lock, LogOut, Megaphone, Settings, UserPlus, Users, Crown, Clock, Gift } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Badge, Button, ButtonLink, ConfirmDialog, RoleBadge, StatusBadge, Tabs } from "../../components/ui";
import { departmentsLabel, formatDate, humanize, plural } from "../../lib/format";
import { APPLICATION_STATUSES, PERMISSIONS } from "../../lib/constants";
import { belongsToScope } from "../../lib/eligibility";
import { ClubSocialRow } from "../../components/clubs/ClubConnect";
import { FollowButton } from "../../components/clubs/NotifyBell";
import { ClubStoryAvatar } from "../../components/stories/ClubStoryAvatar";
import { cssImage } from "../../lib/images";

// The cover sits under a dark overlay (see .hero-cover) so the header text stays readable on any image.
const coverStyle = (src) => (src ? { "--cover": cssImage(src, 1400) } : undefined);

const ClubLayout = () => {
    const { id } = useParams();
    const { user, isStudent } = useAuth();
    const { reloadClubs } = useWorkspace();
    const toast = useToast();
    const { data: club, loading, error, reload } = useApi(() => clubApi.get(id), [id]);
    const [leaving, setLeaving] = useState(false);

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
    const canSeeMembers = viewer.isMember || viewer.isMentor;
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
                    <section className={`hero ${club.coverImage ? "hero-cover" : ""}`} style={coverStyle(club.coverImage)}>
                        <div className="row" style={{ gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                            <ClubStoryAvatar club={club} square />
                            <div className="stack-sm" style={{ flex: 1, minWidth: 220 }}>
                                <div className="row">
                                    <Badge>{humanize(club.category)}</Badge>
                                    <Badge>{departmentsLabel(club)}</Badge>
                                    {club.status !== "ACTIVE" && <StatusBadge status={club.status} />}
                                    {viewer.role && <RoleBadge role={viewer.role} label={viewer.roleName} />}
                                </div>
                                <h1>{club.name}</h1>
                                {club.tagline && <p className="hero-tagline">{club.tagline}</p>}
                                <div className="row small" style={{ gap: 16, color: "#d7defa" }}>
                                    <span className="row" style={{ gap: 6 }}>
                                        <Users size={14} /> {plural(club.memberCount, "member")}
                                    </span>
                                    {club.president && (
                                        <span className="row" style={{ gap: 6 }}>
                                            <Crown size={14} /> {club.president.name}
                                        </span>
                                    )}
                                    {club.mentor && (
                                        <span className="row" style={{ gap: 6 }}>
                                            <GraduationCap size={14} /> Mentor: {club.mentor.name}
                                        </span>
                                    )}
                                </div>
                                <ClubSocialRow club={club} className="on-dark" />
                            </div>
                            <div className="row hero-actions">
                                {user && <FollowButton club={club} />}
                                {/* Students join through recruitment drives. */}
                                {isStudent && club.status === "ACTIVE" && !viewer.isMember &&
                                    (!belongsToScope(user, club) ? (
                                        <span className="hero-note">
                                            <Lock size={14} /> Only for {departmentsLabel(club)} students
                                        </span>
                                    ) : viewer.applications?.some((application) => application.status === "OFFERED") ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}?offer=1`} variant="accent">
                                            <Gift size={16} /> You have an offer — respond
                                        </ButtonLink>
                                    ) : viewer.applications?.length ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}`} variant="secondary">
                                            <Clock size={16} />{" "}
                                            {viewer.applications.length === 1
                                                ? `Application: ${APPLICATION_STATUSES[viewer.applications[0].status]?.[0] || "Submitted"}`
                                                : `Applied for ${viewer.applications.length} roles`}
                                        </ButtonLink>
                                    ) : club.recruiting?.open ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}`} variant="accent">
                                            <UserPlus size={16} /> Apply now · until {formatDate(club.recruiting.applicationEnd)}
                                        </ButtonLink>
                                    ) : club.recruiting ? (
                                        <ButtonLink to={`/recruitment/${club.recruiting._id}`} variant="secondary">
                                            <Megaphone size={16} /> Recruitment opens {formatDate(club.recruiting.applicationStart)}
                                        </ButtonLink>
                                    ) : null)}
                                {viewer.isMember && viewer.role !== "PRESIDENT" && (
                                    <Button variant="secondary" onClick={() => setLeaving(true)}>
                                        <LogOut size={16} /> Leave club
                                    </Button>
                                )}
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
