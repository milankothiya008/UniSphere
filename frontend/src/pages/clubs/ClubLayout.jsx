import { useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { CalendarDays, GraduationCap, Info, Lock, LogOut, Settings, UserPlus, Users, Crown, Clock } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Badge, Button, ConfirmDialog, Modal, RoleBadge, StatusBadge, Tabs, Textarea } from "../../components/ui";
import { departmentsLabel, humanize, plural } from "../../lib/format";
import { PERMISSIONS } from "../../lib/constants";
import { belongsToScope } from "../../lib/eligibility";
import { ClubSocialRow } from "../../components/clubs/ClubConnect";
import { NotifyBell } from "../../components/clubs/NotifyBell";
import { ClubStoryAvatar } from "../../components/stories/ClubStoryAvatar";

// The cover sits under a dark overlay (see .hero-cover) so the header text stays readable on any image.
const coverStyle = (src) => (src ? { "--cover": `url("${String(src).replace(/"/g, "%22")}")` } : undefined);

const JoinDialog = ({ open, onClose, club, onJoined }) => {
    const toast = useToast();
    const [message, setMessage] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            await clubApi.join(club._id, message.trim() || undefined);
            toast.success("Request sent — the club will review it soon");
            onJoined();
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={`Join ${club.name}`}
            description="Club leaders review membership requests."
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" form="join-form" loading={pending}>
                        Send request
                    </Button>
                </>
            }
        >
            <form id="join-form" className="stack" onSubmit={submit}>
                <Textarea label="Message (optional)" placeholder="Tell them why you'd like to join" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
                {error && <Alert type="error">{error.message}</Alert>}
            </form>
        </Modal>
    );
};

const ClubLayout = () => {
    const { id } = useParams();
    const { user, isStudent } = useAuth();
    const { reloadClubs } = useWorkspace();
    const toast = useToast();
    const { data: club, loading, error, reload } = useApi(() => clubApi.get(id), [id]);
    const [joining, setJoining] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [busy, setBusy] = useState(false);

    const refresh = () => {
        reload({ silent: true });
        reloadClubs();
    };

    const withdraw = async () => {
        setBusy(true);
        try {
            await clubApi.cancelJoin(id);
            toast.success("Request withdrawn");
            refresh();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(false);
        }
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
                                    {viewer.role && <RoleBadge role={viewer.role} />}
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
                                {user && <NotifyBell club={club} />}
                                {isStudent && club.status === "ACTIVE" && !viewer.membershipStatus &&
                                    (belongsToScope(user, club) ? (
                                        <Button variant="accent" onClick={() => setJoining(true)}>
                                            <UserPlus size={16} /> Request to join
                                        </Button>
                                    ) : (
                                        <span className="hero-note">
                                            <Lock size={14} /> Only for {departmentsLabel(club)} students
                                        </span>
                                    ))}
                                {viewer.membershipStatus === "PENDING" && (
                                    <Button variant="secondary" onClick={withdraw} loading={busy}>
                                        <Clock size={16} /> Request pending · Withdraw
                                    </Button>
                                )}
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
                    {club.status === "SUSPENDED" && <Alert type="error" title="This club is suspended">Events and membership changes are paused.</Alert>}

                    <Tabs tabs={tabs} />
                    <Outlet context={{ club, reload: refresh }} />

                    <JoinDialog open={joining} onClose={() => setJoining(false)} club={club} onJoined={refresh} />
                    <ConfirmDialog
                        open={leaving}
                        onClose={() => setLeaving(false)}
                        onConfirm={leave}
                        title={`Leave ${club.name}?`}
                        description="You'll lose access to member-only posts and any club role you hold."
                        confirmLabel="Leave club"
                        variant="danger"
                    />
                </div>
            )}
        </AsyncContent>
    );
};

export default ClubLayout;
