import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck2, CalendarDays, CheckCircle2, Compass, Radio, SlidersHorizontal, Sparkles } from "lucide-react";
import { clubApi, eventApi, registrationApi } from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { useQueryState } from "../hooks/useQueryState";
import { useSentinel } from "../hooks/useReveal";
import { EventPost } from "../components/events/EventPost";
import { StoryTray } from "../components/stories/StoryTray";
import { PushPrompt } from "../components/layout/PushPrompt";
import { Avatar, EmptyState, ErrorState, Spinner } from "../components/ui";
import { EVENT_CATEGORIES } from "../lib/constants";
import { categoryStyle, startsInLabel } from "../lib/eventVisuals";
import { countdownParts, formatTimeRange, humanize, plural } from "../lib/format";

const PAGE_SIZE = 8;

const TABS = [
    { value: "ongoing", label: "Live now", icon: Radio },
    { value: "upcoming", label: "Upcoming", icon: CalendarDays },
    { value: "past", label: "Past", icon: Sparkles }
];

const EMPTY = {
    ongoing: "Nothing is live right now",
    upcoming: "No upcoming events yet",
    past: "No past events yet"
};

// Upcoming · Live · Past as plain text tabs, with one filter button beside them.
const FeedTabs = ({ tab, counts, onChange, filtersOpen, onFilters, filtered }) => (
    <div className="feed-bar">
        <div className="feed-tabs" role="tablist">
            {TABS.map(({ value, label }) => (
                <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={`feed-tab ${tab === value ? "active" : ""}`}
                    onClick={() => onChange(value)}
                >
                    {value === "ongoing" && counts.ongoing ? <span className="live-dot" /> : null}
                    {label}
                    {counts[value] ? <span className="count">{counts[value]}</span> : null}
                </button>
            ))}
        </div>
        <button
            type="button"
            className={`icon-button ${filtersOpen || filtered ? "is-on" : ""}`}
            onClick={onFilters}
            aria-expanded={filtersOpen}
            aria-label="Filters"
            title="Filters"
        >
            <SlidersHorizontal size={20} />
        </button>
    </div>
);

const CategoryChips = ({ value, onChange, clubs, club, onClub }) => (
    <div className="feed-filters">
        <div className="cat-chips" role="listbox" aria-label="Category">
            <button type="button" role="option" aria-selected={!value} className={`cat-chip ${!value ? "active" : ""}`} onClick={() => onChange("")}>
                <Compass size={14} /> All
            </button>
            {EVENT_CATEGORIES.map((category) => {
                const Icon = categoryStyle(category).icon;
                return (
                    <button
                        key={category}
                        type="button"
                        role="option"
                        aria-selected={value === category}
                        className={`cat-chip ${value === category ? "active" : ""}`}
                        onClick={() => onChange(value === category ? "" : category)}
                    >
                        <Icon size={14} /> {humanize(category)}
                    </button>
                );
            })}
        </div>
        <select className="select club-select" value={club} onChange={(event) => onClub(event.target.value)} aria-label="Club">
            <option value="">All clubs</option>
            {clubs.map((item) => (
                <option key={item._id} value={item._id}>
                    {item.name}
                </option>
            ))}
        </select>
    </div>
);

const PostSkeleton = () => (
    <div className="card post-skeleton" aria-hidden="true">
        <div className="row" style={{ padding: 16, gap: 12 }}>
            <span className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%" }} />
            <span className="stack-sm grow" style={{ gap: 6 }}>
                <span className="skeleton" style={{ width: "40%", height: 12 }} />
                <span className="skeleton" style={{ width: "25%", height: 10 }} />
            </span>
        </div>
        <span className="skeleton" style={{ display: "block", aspectRatio: "16 / 10", borderRadius: 0 }} />
        <div className="stack-sm" style={{ padding: 16 }}>
            <span className="skeleton" style={{ width: "60%", height: 16 }} />
            <span className="skeleton" style={{ width: "90%", height: 12 }} />
            <span className="skeleton" style={{ width: "75%", height: 12 }} />
        </div>
    </div>
);

// ---------------------------------------------------------------- sidebar

const useTicker = (ms = 30000) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(timer);
    }, [ms]);
    return now;
};

const NextEvent = ({ registrations }) => {
    const now = useTicker();
    const next = registrations.find((registration) => new Date(registration.event.endAt).getTime() > now);

    if (!next) {
        return (
            <div className="side-card next-card is-empty">
                <span className="side-eyebrow">
                    <CalendarCheck2 size={14} /> You're going
                </span>
                <strong>Nothing booked yet</strong>
                <span>Register for an event and a countdown appears here.</span>
            </div>
        );
    }

    const { event } = next;
    const live = new Date(event.startAt).getTime() <= now;
    const others = registrations.filter((registration) => registration !== next).slice(0, 3);

    return (
        <div className="side-card next-card">
            <span className="side-eyebrow">
                {live ? (
                    <>
                        <span className="live-dot" /> Happening now
                    </>
                ) : (
                    <>
                        <CalendarCheck2 size={14} /> Your next event
                    </>
                )}
            </span>
            <Link to={`/events/${event._id}`} className="next-card-title">
                {event.title}
            </Link>
            <span className="next-card-meta">
                {formatTimeRange(event.startAt, event.endAt)}
                {event.venue?.name ? ` · ${event.venue.name}` : ""}
            </span>
            {!live && (
                <div className="mini-countdown">
                    {countdownParts(new Date(event.startAt).getTime() - now).map(([value, unit]) => (
                        <span key={unit}>
                            <b>{value}</b>
                            {unit}
                        </span>
                    ))}
                </div>
            )}
            {others.length > 0 && (
                <div className="next-card-more">
                    {others.map((registration) => (
                        <Link key={registration._id} to={`/events/${registration.event._id}`}>
                            <span>{registration.event.title}</span>
                            <small>{startsInLabel(registration.event.startAt, now)?.replace("Starts in ", "in ") || "now"}</small>
                        </Link>
                    ))}
                </div>
            )}
            <Link to="/my-registrations" className="next-card-link">
                All my events <ArrowRight size={14} />
            </Link>
        </div>
    );
};

const Suggested = ({ clubs }) => {
    const top = [...(clubs || [])].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).slice(0, 5);
    if (!top.length) {
        return null;
    }
    return (
        <section className="side-suggest">
            <div className="side-suggest-head">
                <span>Clubs for you</span>
                <Link to="/clubs">See all</Link>
            </div>
            {top.map((club) => (
                <Link key={club._id} to={`/clubs/${club._id}`} className="side-person">
                    <Avatar name={club.name} src={club.logo} />
                    <span className="grow">
                        <strong>{club.name}</strong>
                        <small>
                            {humanize(club.category)} · {plural(club.memberCount || 0, "member")}
                        </small>
                    </span>
                </Link>
            ))}
        </section>
    );
};

const Sidebar = ({ clubs, refreshKey }) => {
    const { user, isStudent } = useAuth();
    const [upcoming, setUpcoming] = useState([]);

    useEffect(() => {
        if (!isStudent) {
            return;
        }
        registrationApi
            .mine({ timeframe: "upcoming" })
            .then((response) => setUpcoming(response.data))
            .catch(() => setUpcoming([]));
    }, [isStudent, refreshKey]);

    return (
        <aside className="feed-side">
            <Link to="/profile" className="side-person side-me">
                <Avatar name={user.name} src={user.avatar} size="lg" />
                <span className="grow">
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                </span>
            </Link>
            {isStudent && <NextEvent registrations={upcoming} />}
            <Suggested clubs={clubs} />
            <p className="side-foot">© {new Date().getFullYear()} CampusConnect</p>
        </aside>
    );
};

// ---------------------------------------------------------------- page

const FeedPage = () => {
    const [filters, setFilters] = useQueryState({ tab: "", category: "", club: "", search: "" });
    // Opening the app shows what's live right now first; with nothing live it falls back to upcoming.
    const [autoTab, setAutoTab] = useState("ongoing");
    const tab = filters.tab || autoTab;
    const [clubs, setClubs] = useState(null);
    const [state, setState] = useState({ items: [], page: 0, totalPages: 1, counts: null, loading: true, error: null });
    const [filtersOpen, setFiltersOpen] = useState(Boolean(filters.category || filters.club));
    const [registrations, setRegistrations] = useState(0);

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
                    timeframe: tab,
                    category: filters.category,
                    club: filters.club,
                    search: filters.search,
                    page,
                    limit: PAGE_SIZE,
                    withCounts: page === 1 ? "true" : undefined
                });
                if (!filters.tab && tab === "ongoing" && page === 1 && !response.data.length) {
                    setAutoTab("upcoming");
                    return;
                }
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
        [tab, filters.tab, filters.category, filters.club, filters.search]
    );

    useEffect(() => {
        load(1);
    }, [load]);

    const hasMore = !state.loading && !state.error && state.page < state.totalPages;
    const sentinel = useSentinel(() => load(state.page + 1), hasMore);

    const counts = state.counts || {};
    const filtered = Boolean(filters.search || filters.category || filters.club);

    return (
        <div className="feed-layout">
            <div className="feed-main">
                <StoryTray clubs={clubs} />
                <PushPrompt />
                <FeedTabs
                    tab={tab}
                    counts={counts}
                    onChange={(tab) => setFilters({ tab })}
                    filtersOpen={filtersOpen}
                    onFilters={() => setFiltersOpen((open) => !open)}
                    filtered={filtered}
                />
                {filtersOpen && (
                    <CategoryChips
                        value={filters.category}
                        onChange={(category) => setFilters({ category })}
                        clubs={clubs || []}
                        club={filters.club}
                        onClub={(club) => setFilters({ club })}
                    />
                )}

                {filtered && (
                    <div className="active-filters">
                        <span className="subtle">{state.loading ? "Searching…" : plural(counts[tab] ?? state.items.length, "event")}</span>
                        <button type="button" className="link-button" onClick={() => setFilters({ search: "", category: "", club: "" })}>
                            Clear filters
                        </button>
                    </div>
                )}

                {state.error && !state.items.length ? (
                    <ErrorState error={state.error} onRetry={() => load(1)} />
                ) : (
                    <div className="feed-posts">
                        {state.items.map((event, index) => (
                            <EventPost key={event._id} event={event} index={index} onRegistered={() => setRegistrations((n) => n + 1)} />
                        ))}

                        {state.loading && state.page === 0 && [1, 2].map((key) => <PostSkeleton key={key} />)}
                        {state.loading && state.page > 0 && (
                            <div className="feed-loading">
                                <Spinner />
                            </div>
                        )}

                        {!state.loading && state.items.length === 0 && (
                            <EmptyState
                                icon={tab === "ongoing" ? Radio : CalendarDays}
                                title={filtered ? "No events match your filters" : EMPTY[tab] || EMPTY.upcoming}
                            />
                        )}

                        {hasMore && <div ref={sentinel} className="feed-sentinel" />}
                        {!state.loading && state.items.length > 0 && state.page >= state.totalPages && (
                            <p className="feed-end">
                                <CheckCircle2 size={28} strokeWidth={1.5} />
                                You're all caught up
                            </p>
                        )}
                    </div>
                )}
            </div>

            <Sidebar clubs={clubs} refreshKey={registrations} />
        </div>
    );
};

export default FeedPage;
