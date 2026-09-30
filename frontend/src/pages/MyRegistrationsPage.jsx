import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck2, MailPlus } from "lucide-react";
import { eventApi, registrationApi } from "../api/endpoints";
import { useToast } from "../context/ToastContext";
import { formatDate, timeAgo } from "../lib/format";
import { useApi } from "../hooks/useApi";
import { useQueryState } from "../hooks/useQueryState";
import { EventCard } from "../components/events/EventCard";
import { AsyncContent, Avatar, Button, ButtonLink, Card, CardGridSkeleton, EmptyState, PageHeader, Tabs } from "../components/ui";

// Team invites waiting for an answer, across all events.
const TeamInvitesCard = ({ onAnswered }) => {
    const toast = useToast();
    const { data, reload } = useApi(() => registrationApi.invites(), []);
    const [busy, setBusy] = useState(null);

    if (!data?.length) {
        return null;
    }

    const respond = async (invite, accept) => {
        setBusy(`${invite.team._id}-${accept}`);
        try {
            const response = accept ? await eventApi.acceptTeamInvite(invite.event._id, invite.team._id) : await eventApi.declineTeamInvite(invite.event._id, invite.team._id);
            toast.success(response.message);
            reload({ silent: true });
            onAnswered();
        } catch (error) {
            toast.error(error);
            reload({ silent: true });
        } finally {
            setBusy(null);
        }
    };

    return (
        <Card
            className="invites-card"
            title={
                <h2 className="row">
                    <MailPlus size={18} /> Team invites · {data.length}
                </h2>
            }
        >
            <div className="stack-sm">
                {data.map((invite) => (
                    <div key={invite.team._id} className="team-invite">
                        <Avatar name={invite.event.club?.name} src={invite.event.club?.logo} square />
                        <div className="grow">
                            <strong>
                                {invite.team.leader?.name} invited you to "{invite.team.name}"
                            </strong>
                            <span className="subtle small">
                                <Link to={`/events/${invite.event._id}`}>{invite.event.title}</Link> · {formatDate(invite.event.startAt)} · invited {timeAgo(invite.invitedAt)}
                            </span>
                        </div>
                        <div className="team-invite-actions">
                            <Button size="sm" onClick={() => respond(invite, true)} loading={busy === `${invite.team._id}-true`} disabled={Boolean(busy)}>
                                Accept
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => respond(invite, false)} loading={busy === `${invite.team._id}-false`} disabled={Boolean(busy)}>
                                Decline
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
};

const MyRegistrationsPage = () => {
    const [filters, setFilters] = useQueryState({ timeframe: "upcoming" });
    const { data, loading, error, reload } = useApi(() => registrationApi.mine({ timeframe: filters.timeframe, includeWaitlist: filters.timeframe === "upcoming" ? "true" : undefined }), [filters.timeframe]);

    return (
        <>
            <PageHeader
                title="Your events"
            />
            <div className="stack">
                <TeamInvitesCard onAnswered={() => reload({ silent: true })} />
                <Tabs
                    tabs={[
                        { value: "upcoming", label: "Upcoming" },
                        { value: "past", label: "Past" }
                    ]}
                    value={filters.timeframe}
                    onChange={(timeframe) => setFilters({ timeframe })}
                />
                <AsyncContent
                    loading={loading}
                    error={error}
                    onRetry={reload}
                    isEmpty={!data?.length}
                    skeleton={<CardGridSkeleton count={3} />}
                    empty={
                        <EmptyState
                            icon={CalendarCheck2}
                            title={filters.timeframe === "upcoming" ? "No upcoming registrations" : "No past events yet"}
                            description="Find something interesting and register before the deadline."
                            action={<ButtonLink to="/feed">Browse the campus feed</ButtonLink>}
                        />
                    }
                >
                    <div className="grid-cards">
                        {data?.map((registration) => (
                            <EventCard
                                key={registration._id}
                                event={{
                                    ...registration.event,
                                    myRegistration: registration.status || "REGISTERED",
                                    waitlistPosition: registration.waitlistPosition,
                                    teamName: registration.team?.name,
                                    teamRole: registration.teamRole,
                                    ticketCode: registration.ticketCode,
                                    checkedInAt: registration.checkedInAt
                                }}
                                showStatus={filters.timeframe === "past"}
                            />
                        ))}
                    </div>
                </AsyncContent>
            </div>
        </>
    );
};

export default MyRegistrationsPage;
