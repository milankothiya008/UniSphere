import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck2, CalendarDays, Megaphone, Plus, Radio, Sparkles } from "lucide-react";
import { clubApi, eventApi, registrationApi } from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useQueryState } from "../hooks/useQueryState";
import { useDebounce } from "../hooks/useDebounce";
import { EventPost } from "../components/events/EventPost";
import { PostComposer } from "../components/feed/PostComposer";
import { Avatar, Button, ButtonLink, Card, EmptyState, ErrorState, Modal, PageHeader, SearchInput, Skeleton } from "../components/ui";
import { EVENT_CATEGORIES } from "../lib/constants";
import { dateParts, formatTimeRange, humanize } from "../lib/format";

const PAGE_SIZE = 8;

const TABS = [
    { value: "ongoing", label: "Live now", icon: Radio },
    { value: "upcoming", label: "Upcoming", icon: CalendarDays },
    { value: "past", label: "Past", icon: Sparkles }
];

const EMPTY = {
    ongoing: ["Nothing is live right now", "Events that are happening at this moment show up here."],
    upcoming: ["No upcoming events yet", "When clubs publish events, they appear here with their posters."],
    past: ["No past events yet", "Completed events and their results appear here."]
};

// Horizontal strip of active clubs, like stories at the top of a social feed.
const ClubStrip = () => {
    const [clubs, setClubs] = useState(null);

    useEffect(() => {
        clubApi
            .list({ limit: 30 })
            .then((response) => setClubs(response.data))
            .catch(() => setClubs([]));
    }, []);

    if (clubs && clubs.length === 0) {
        return null;
    }

    return (
        <div className="club-strip" aria-label="Clubs">
            {(clubs || Array.from({ length: 6 }, (_, i) => ({ _id: `s${i}` }))).map((club) =>
                club.name ? (
                    <Link key={club._id} to={`/clubs/${club._id}`} className="club-strip-item" title={club.name}>
                        <span className="club-strip-ring">
                            <Avatar name={club.name} src={club.logo} size="lg" />
                        </span>
                        <span className="club-strip-name">{club.name}</span>
                    </Link>
                ) : (
                    <span key={club._id} className="club-strip-item">
                        <Skeleton height={62} width={62} style={{ borderRadius: "50%" }} />
                    </span>
                )
            )}
        </div>
    );
};

const Sidebar = ({ onAnnounce, canAnnounce, canCreate, refreshKey }) => {
    const { isStudent } = useAuth();
    const [upcoming, setUpcoming] = useState([]);

    useEffect(() => {
        if (!isStudent) {
            return;
        }
        registrationApi
            .mine({ timeframe: "upcoming" })
            .then((response) => setUpcoming(response.data.slice(0, 4)))
            .catch(() => setUpcoming([]));
    }, [isStudent, refreshKey]);

    return (
        <aside className="feed-side stack">
            {(canAnnounce || canCreate) && (
                <Card>
                    <div className="stack-sm">
                        <strong>Share with campus</strong>
                        <p className="subtle">Announcements notify everyone on CampusConnect. Published events appear in this feed.</p>
                        {canCreate && (
                            <ButtonLink to="/events/create" size="sm">
                                <Plus size={15} /> Create event
                            </ButtonLink>
                        )}
                        {canAnnounce && (
                            <Button variant="secondary" size="sm" onClick={onAnnounce}>
                                <Megaphone size={15} /> Send announcement
                            </Button>
                        )}
                    </div>
                </Card>
            )}
            {isStudent && (
                <Card
                    title={
                        <h2 className="row">
                            <CalendarCheck2 size={16} /> You're going
                        </h2>
                    }
                    actions={
                        <Link to="/my-registrations" className="small">
                            All
                        </Link>
                    }
                    padded={false}
                >
                    {upcoming.length === 0 ? (
                        <p className="subtle card-body">Register for an event and it shows up here.</p>
                    ) : (
                        <div className="list-rows">
                            {upcoming.map((registration) => {
                                const { month, day } = dateParts(registration.event.startAt);
                                return (
                                    <Link key={registration._id} to={`/events/${registration.event._id}`} className="list-row">
                                        <span className="date-chip" style={{ position: "static", boxShadow: "none", border: "1px solid var(--border)" }}>
                                            <span className="mon" style={{ display: "block" }}>
                                                {month}
                                            </span>
                                            <span className="day" style={{ display: "block" }}>
                                                {day}
                                            </span>
                                        </span>
                                        <span className="grow">
                                            <span className="title" style={{ display: "block" }}>
                                                {registration.event.title}
                                            </span>
                                            <span className="subtle">{formatTimeRange(registration.event.startAt, registration.event.endAt)}</span>
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </Card>
            )}
        </aside>
    );
};

const FeedPage = () => {
    const { postingClubs, eventClubs } = useWorkspace();
    const [filters, setFilters] = useQueryState({ tab: "upcoming", category: "", club: "", search: "" });
    const [search, setSearch] = useState(filters.search);
    const debounced = useDebounce(search, 350);
    const [clubs, setClubs] = useState([]);
    const [state, setState] = useState({ items: [], page: 0, totalPages: 1, counts: null, loading: true, error: null });
    const [composing, setComposing] = useState(false);
    const [registrations, setRegistrations] = useState(0);

    useEffect(() => {
        if (debounced !== filters.search) {
            setFilters({ search: debounced });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced]);

    useEffect(() => {
        clubApi
            .list({ limit: 50 })
            .then((response) => setClubs(response.data))
            .catch(() => setClubs([]));
    }, []);

    const load = useCallback(
        async (page) => {
            setState((prev) => ({ ...prev, loading: true, error: null, ...(page === 1 ? { items: [] } : {}) }));
            try {
                const response = await eventApi.list({
                    timeframe: filters.tab,
                    category: filters.category,
                    club: filters.club,
                    search: filters.search,
                    page,
                    limit: PAGE_SIZE,
                    withCounts: page === 1 ? "true" : undefined
                });
                setState((prev) => ({
                    items: page === 1 ? response.data : [...prev.items, ...response.data],
                    page,
                    totalPages: response.meta.totalPages,
                    counts: response.meta.counts || prev.counts,
                    loading: false,
                    error: null
                }));
            } catch (error) {
                setState((prev) => ({ ...prev, loading: false, error }));
            }
        },
        [filters.tab, filters.category, filters.club, filters.search]
    );

    useEffect(() => {
        load(1);
    }, [load]);

    const counts = state.counts || {};
    const filtered = Boolean(filters.search || filters.category || filters.club);
    const [emptyTitle, emptyText] = EMPTY[filters.tab] || EMPTY.upcoming;

    return (
        <>
            <PageHeader
                eyebrow={<><Sparkles size={14} /> Campus feed</>}
                title="What's happening on campus"
                description="Every club event in one place — see what's live, what's next and who won."
            />

            <div className="feed-layout">
                <div className="feed-main">
                    <ClubStrip />

                    <div className="feed-tabs" role="tablist">
                        {TABS.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={filters.tab === value}
                                className={`feed-tab ${filters.tab === value ? "active" : ""}`}
                                onClick={() => setFilters({ tab: value })}
                            >
                                {value === "ongoing" && counts.ongoing ? <span className="live-dot" /> : <Icon size={15} />}
                                {label}
                                {counts[value] !== undefined && <span className="count">{counts[value]}</span>}
                            </button>
                        ))}
                    </div>

                    <div className="filter-bar">
                        <SearchInput value={search} onChange={setSearch} placeholder="Search events" />
                        <select className="select" value={filters.category} onChange={(e) => setFilters({ category: e.target.value })} aria-label="Category">
                            <option value="">All categories</option>
                            {EVENT_CATEGORIES.map((category) => (
                                <option key={category} value={category}>
                                    {humanize(category)}
                                </option>
                            ))}
                        </select>
                        <select className="select" value={filters.club} onChange={(e) => setFilters({ club: e.target.value })} aria-label="Club">
                            <option value="">All clubs</option>
                            {clubs.map((club) => (
                                <option key={club._id} value={club._id}>
                                    {club.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {state.error && !state.items.length ? (
                        <ErrorState error={state.error} onRetry={() => load(1)} />
                    ) : (
                        <div className="feed-posts">
                            {state.items.map((event) => (
                                <EventPost key={event._id} event={event} onRegistered={() => setRegistrations((n) => n + 1)} />
                            ))}

                            {state.loading && [1, 2].map((key) => <Skeleton key={key} height={520} style={{ borderRadius: 16 }} />)}

                            {!state.loading && state.items.length === 0 && (
                                <Card>
                                    <EmptyState
                                        icon={filters.tab === "ongoing" ? Radio : CalendarDays}
                                        title={filtered ? "No events match your filters" : emptyTitle}
                                        description={filtered ? "Try clearing a filter." : emptyText}
                                    />
                                </Card>
                            )}

                            {!state.loading && state.page < state.totalPages && (
                                <Button variant="secondary" block onClick={() => load(state.page + 1)}>
                                    Load more events
                                </Button>
                            )}
                            {!state.loading && state.items.length > 0 && state.page >= state.totalPages && (
                                <p className="subtle" style={{ textAlign: "center" }}>
                                    You're all caught up.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <Sidebar onAnnounce={() => setComposing(true)} canAnnounce={postingClubs.length > 0} canCreate={eventClubs.length > 0} refreshKey={registrations} />
            </div>

            <Modal
                open={composing}
                onClose={() => setComposing(false)}
                title="Send an announcement"
                description="Public announcements notify everyone on CampusConnect."
                size="lg"
            >
                <PostComposer clubs={postingClubs} onPosted={() => setComposing(false)} />
            </Modal>
        </>
    );
};

export default FeedPage;
