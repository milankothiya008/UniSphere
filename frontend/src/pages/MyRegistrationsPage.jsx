import { CalendarCheck2 } from "lucide-react";
import { registrationApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useQueryState } from "../hooks/useQueryState";
import { EventCard } from "../components/events/EventCard";
import { AsyncContent, ButtonLink, CardGridSkeleton, EmptyState, PageHeader, Tabs } from "../components/ui";

const MyRegistrationsPage = () => {
    const [filters, setFilters] = useQueryState({ timeframe: "upcoming" });
    const { data, loading, error, reload } = useApi(() => registrationApi.mine({ timeframe: filters.timeframe, includeWaitlist: filters.timeframe === "upcoming" ? "true" : undefined }), [filters.timeframe]);

    return (
        <>
            <PageHeader
                eyebrow={<><CalendarCheck2 size={14} /> My registrations</>}
                title="Your events"
                description="Everything you've registered for, plus events you're on the waitlist for."
            />
            <div className="stack">
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
                                event={{ ...registration.event, myRegistration: registration.status || "REGISTERED", waitlistPosition: registration.waitlistPosition }}
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
