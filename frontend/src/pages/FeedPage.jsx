import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    ArrowRight,
    CalendarCheck2,
    CalendarDays,
    ChevronRight,
    Compass,
    Megaphone,
    Plus,
    Radio,
    Search,
    Sparkles,
    Users,
    X
} from "lucide-react";
import { clubApi, eventApi, registrationApi } from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useQueryState } from "../hooks/useQueryState";
import { useDebounce } from "../hooks/useDebounce";
import { useSentinel } from "../hooks/useReveal";
import { EventPost } from "../components/events/EventPost";
import { PostComposer } from "../components/feed/PostComposer";
import { StoryTray } from "../components/stories/StoryTray";
import { Avatar, Button, ButtonLink, EmptyState, ErrorState, Modal, Spinner } from "../components/ui";
import { EVENT_CATEGORIES } from "../lib/constants";
import { categoryStyle, startsInLabel } from "../lib/eventVisuals";
import { countdownParts, dateParts, formatTimeRange, humanize, plural } from "../lib/format";

const PAGE_SIZE = 8;
const DAY = 86400000;

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

// ---------------------------------------------------------------- header

const FeedHero = ({ search, onSearch, counts, tab, onTab }) => (
    <section className="feed-hero">
        <div className="feed-hero-art" aria-hidden="true">
            <span className="orb orb-a" />
            <span className="orb orb-b" />
            <span className="orb orb-c" />
        </div>
        <div className="feed-hero-copy">
            <span className="feed-hero-eyebrow">
                <Sparkles size={14} /> Campus feed
            </span>
            <h1>What's happening on campus</h1>
            <p>Every club event in one place — see what's live, what's next and who won.</p>
        </div>
        <label className="feed-search">
            <Search size={18} />
            <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search events, e.g. hackathon, music, quiz…" aria-label="Search events" />
            {search && (
                <button type="button" onClick={() => onSearch("")} aria-label="Clear search">
                    <X size={16} />
                </button>
            )}
        </label>
        <div className="feed-hero-stats">
            {TABS.map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" className={`hero-count ${tab === value ? "active" : ""}`} onClick={() => onTab(value)}>
                    {value === "ongoing" && counts.ongoing ? <span className="live-dot" /> : <Icon size={14} />}
                    <b>{counts[value] ?? "–"}</b> {label.toLowerCase()}
                </button>
            ))}
        </div>
    </section>
);

// Segmented tabs with a highlight that slides to the active tab.
const FeedTabs = ({ tab, counts, onChange }) => {
    const index = Math.max(0, TABS.findIndex((item) => item.value === tab));
    return (
        <div className="slide-tabs" role="tablist" style={{ "--index": index, "--count": TABS.length }}>
            <span className="slide-tabs-indicator" aria-hidden="true" />
            {TABS.map(({ value, label, icon: Icon }) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} className={`slide-tab ${tab === value ? "active" : ""}`} onClick={() => onChange(value)}>
                    {value === "ongoing" && counts.ongoing ? <span className="live-dot" /> : <Icon size={15} />}
                    {label}
                    {counts[value] !== undefined && <span className="count">{counts[value]}</span>}
                </button>
            ))}
        </div>
    );
};

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
            <span className="side-eyebrow">{live ? <><span className="live-dot" /> Happening now</> : <><CalendarCheck2 size={14} /> Your next event</>}</span>
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

const ThisWeek = () => {
    const [events, setEvents] = useState(null);

    useEffect(() => {
        eventApi
            .list({ timeframe: "upcoming", limit: 8 })
            .then((response) => setEvents(response.data.filter((event) => new Date(event.startAt).getTime() - Date.now() < 7 * DAY).slice(0, 5)))
            .catch(() => setEvents([]));
    }, []);

    return (
        <div className="card side-list">
            <div className="side-list-head">
                <h3>
                    <CalendarDays size={16} /> This week
                </h3>
            </div>
            {events === null ? (
                <div className="stack-sm" style={{ padding: "4px 16px 16px" }}>
                    {[1, 2].map((key) => (
                        <span key={key} className="skeleton" style={{ height: 40 }} />
                    ))}
                </div>
            ) : events.length ? (
                <ul>
                    {events.map((event) => {
                        const { month, day } = dateParts(event.startAt);
                        const Icon = categoryStyle(event.category).icon;
                        return (
                            <li key={event._id}>
                                <Link to={`/events/${event._id}`} className="week-row">
                                    <span className="week-date">
                                        <small>{month}</small>
                                        <b>{day}</b>
                                    </span>
                                    <span className="grow">
                                        <strong>{event.title}</strong>
                                        <small>
                                            <Icon size={12} /> {event.club?.name}
                                        </small>
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className="subtle side-empty">A quiet week — check back soon.</p>
            )}
        </div>
    );
};

const PopularClubs = ({ clubs }) => {
    const top = [...(clubs || [])].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).slice(0, 4);
    if (!top.length) {
        return null;
    }
    return (
        <div className="card side-list">
            <div className="side-list-head">
                <h3>
                    <Users size={16} /> Popular clubs
                </h3>
                <Link to="/clubs" className="small">
                    See all
                </Link>
            </div>
            <ul>
                {top.map((club) => (
                    <li key={club._id}>
                        <Link to={`/clubs/${club._id}`} className="week-row">
                            <Avatar name={club.name} src={club.logo} square />
                            <span className="grow">
                                <strong>{club.name}</strong>
                                <small>
                                    {humanize(club.category)} · {plural(club.memberCount || 0, "member")}
                                </small>
                            </span>
                            <ChevronRight size={16} className="subtle" />
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const Sidebar = ({ clubs, onAnnounce, canAnnounce, canCreate, refreshKey }) => {
    const { isStudent } = useAuth();
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
            {isStudent && <NextEvent registrations={upcoming} />}
            {(canAnnounce || canCreate) && (
                <div className="side-card create-card">
                    <strong>Share with campus</strong>
                    <span>Publish an event or send an announcement to everyone.</span>
                    <div className="row" style={{ gap: 8 }}>
                        {canCreate && (
                            <ButtonLink to="/events/create" size="sm" variant="accent">
                                <Plus size={15} /> Create event
                            </ButtonLink>
                        )}
                        {canAnnounce && (
                            <Button size="sm" className="btn-glass" variant="secondary" onClick={onAnnounce}>
                                <Megaphone size={15} /> Announce
                            </Button>
                        )}
                    </div>
                </div>
            )}
            <ThisWeek />
            <PopularClubs clubs={clubs} />
        </aside>
    );
};

// ---------------------------------------------------------------- page

const FeedPage = () => {
    const { postingClubs, eventClubs } = useWorkspace();
    const [filters, setFilters] = useQueryState({ tab: "upcoming", category: "", club: "", search: "" });
    const [search, setSearch] = useState(filters.search);
    const debounced = useDebounce(search, 350);
    const [clubs, setClubs] = useState(null);
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

    const hasMore = !state.loading && !state.error && state.page < state.totalPages;
    const sentinel = useSentinel(() => load(state.page + 1), hasMore);

    const counts = state.counts || {};
    const filtered = Boolean(filters.search || filters.category || filters.club);
    const [emptyTitle, emptyText] = EMPTY[filters.tab] || EMPTY.upcoming;

    return (
        <>
            <FeedHero search={search} onSearch={setSearch} counts={counts} tab={filters.tab} onTab={(tab) => setFilters({ tab })} />

            <div className="feed-layout">
                <div className="feed-main">
                    <StoryTray clubs={clubs} />
                    <FeedTabs tab={filters.tab} counts={counts} onChange={(tab) => setFilters({ tab })} />
                    <CategoryChips
                        value={filters.category}
                        onChange={(category) => setFilters({ category })}
                        clubs={clubs || []}
                        club={filters.club}
                        onClub={(club) => setFilters({ club })}
                    />

                    {filtered && (
                        <div className="active-filters">
                            <span className="subtle">
                                {state.loading ? "Searching…" : `${plural(counts[filters.tab] ?? state.items.length, "event")} found`}
                            </span>
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => {
                                    setSearch("");
                                    setFilters({ search: "", category: "", club: "" });
                                }}
                            >
                                <X size={14} /> Clear filters
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
                                    <Spinner /> Loading more events…
                                </div>
                            )}

                            {!state.loading && state.items.length === 0 && (
                                <div className="card feed-empty">
                                    <EmptyState
                                        icon={filters.tab === "ongoing" ? Radio : CalendarDays}
                                        title={filtered ? "No events match your filters" : emptyTitle}
                                        description={filtered ? "Try another category or clear the search." : emptyText}
                                    />
                                </div>
                            )}

                            {hasMore && (
                                <div ref={sentinel}>
                                    <Button variant="secondary" block onClick={() => load(state.page + 1)}>
                                        Load more events
                                    </Button>
                                </div>
                            )}
                            {!state.loading && state.items.length > 0 && state.page >= state.totalPages && (
                                <p className="feed-end">
                                    <Sparkles size={14} /> You're all caught up
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <Sidebar clubs={clubs} onAnnounce={() => setComposing(true)} canAnnounce={postingClubs.length > 0} canCreate={eventClubs.length > 0} refreshKey={registrations} />
            </div>

            <Modal open={composing} onClose={() => setComposing(false)} title="Send an announcement" description="Public announcements notify everyone on CampusConnect." size="lg">
                <PostComposer clubs={postingClubs} onPosted={() => setComposing(false)} />
            </Modal>
        </>
    );
};

export default FeedPage;
