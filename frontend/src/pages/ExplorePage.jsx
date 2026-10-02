import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Award, Building2, CalendarDays, Images, Search, X } from "lucide-react";
import { clubApi, eventApi, userApi } from "../api/endpoints";
import { useDebounce } from "../hooks/useDebounce";
import { useQueryState } from "../hooks/useQueryState";
import { Avatar, EmptyState, Skeleton } from "../components/ui";
import { categoryStyle, categoryVars } from "../lib/eventVisuals";
import { imageUrl } from "../lib/images";
import { isLive } from "../lib/eligibility";
import { batchLabel, formatDate, humanize, plural } from "../lib/format";
import { ROLE_LABELS } from "../lib/constants";

const SHORTCUTS = [
    { to: "/clubs", icon: Building2, label: "Clubs" },
    { to: "/results", icon: Award, label: "Results" },
    { to: "/gallery", icon: Images, label: "Gallery" }
];

// One square of the explore grid: the poster, or the category's colours with the title.
const Tile = ({ event }) => {
    const Icon = categoryStyle(event.category).icon;
    return (
        <Link to={`/events/${event._id}`} className="explore-tile" style={categoryVars(event.category)} title={event.title}>
            {event.poster ? (
                <img src={imageUrl(event.poster, 320)} alt={event.title} loading="lazy" decoding="async" />
            ) : (
                <span className="explore-tile-fallback">
                    <Icon size={26} />
                    <strong>{event.title}</strong>
                </span>
            )}
            {isLive(event) && <span className="explore-tile-live">Live</span>}
            <span className="explore-tile-hover">
                <strong>{event.title}</strong>
                <span>{formatDate(event.startAt)}</span>
            </span>
        </Link>
    );
};

const Grid = ({ events }) => (
    <div className="explore-grid">
        {events.map((event) => (
            <Tile key={event._id} event={event} />
        ))}
    </div>
);

const GridSkeleton = () => (
    <div className="explore-grid">
        {Array.from({ length: 9 }, (_, index) => (
            <Skeleton key={index} style={{ aspectRatio: "1", height: "auto", borderRadius: 0 }} />
        ))}
    </div>
);

const useExploreResults = (search) => {
    const [state, setState] = useState({ loading: true, clubs: [], events: [], people: [] });

    useEffect(() => {
        let alive = true;
        setState((prev) => ({ ...prev, loading: true }));
        const load = search
            ? Promise.all([
                  clubApi.list({ search, limit: 8 }),
                  eventApi.list({ search, timeframe: "upcoming", limit: 12 }),
                  eventApi.list({ search, timeframe: "past", limit: 12 }),
                  search.length >= 2 ? userApi.people(search) : Promise.resolve({ data: [] })
              ]).then(([clubs, upcoming, past, people]) => ({ clubs: clubs.data, events: [...upcoming.data, ...past.data], people: people.data }))
            : Promise.all([eventApi.list({ timeframe: "ongoing", limit: 6 }), eventApi.list({ timeframe: "upcoming", limit: 18 }), eventApi.list({ timeframe: "past", limit: 12 })]).then(
                  ([live, upcoming, past]) => ({ clubs: [], events: [...live.data, ...upcoming.data, ...past.data], people: [] })
              );
        load
            .then((result) => alive && setState({ loading: false, ...result }))
            .catch(() => alive && setState({ loading: false, clubs: [], events: [], people: [] }));
        return () => {
            alive = false;
        };
    }, [search]);

    return state;
};

/** Search clubs and events, jump to clubs, results and the gallery, and browse every event as a poster grid. */
const ExplorePage = () => {
    const [filters, setFilters] = useQueryState({ search: "" });
    const [search, setSearch] = useState(filters.search);
    const debounced = useDebounce(search.trim(), 300);
    const { loading, clubs, events, people } = useExploreResults(debounced);

    useEffect(() => {
        if (debounced !== filters.search) {
            setFilters({ search: debounced });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced]);

    return (
        <div className="explore">
            <label className="explore-search">
                <Search size={18} />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search clubs, events and people" />
                {search && (
                    <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                        <X size={16} />
                    </button>
                )}
            </label>

            {!debounced && (
                <nav className="explore-shortcuts" aria-label="Browse">
                    {SHORTCUTS.map((item) => (
                        <NavLink key={item.to} to={item.to} className="explore-chip">
                            <item.icon size={16} /> {item.label}
                        </NavLink>
                    ))}
                </nav>
            )}

            {debounced && people.length > 0 && (
                <section className="explore-clubs" aria-label="People">
                    <h2 className="explore-heading">People</h2>
                    {people.map((person) => (
                        <Link key={person._id} to={person.isSelf ? "/profile" : `/people/${person._id}`} className="explore-club">
                            <Avatar name={person.name} src={person.avatar} />
                            <span className="grow">
                                <strong>{person.name}</strong>
                                <span className="subtle">
                                    {[ROLE_LABELS[person.globalRole], person.departmentCode, person.batchCode && `Batch ${batchLabel(person.batchCode)}`].filter(Boolean).join(" · ")}
                                </span>
                            </span>
                        </Link>
                    ))}
                </section>
            )}

            {debounced && clubs.length > 0 && (
                <section className="explore-clubs" aria-label="Clubs">
                    {people.length > 0 && <h2 className="explore-heading">Clubs</h2>}
                    {clubs.map((club) => (
                        <Link key={club._id} to={`/clubs/${club._id}`} className="explore-club">
                            <Avatar name={club.name} src={club.logo} />
                            <span className="grow">
                                <strong>{club.name}</strong>
                                <span className="subtle">
                                    {humanize(club.category)} · {plural(club.memberCount || 0, "member")}
                                </span>
                            </span>
                        </Link>
                    ))}
                </section>
            )}

            {loading && !events.length ? (
                <GridSkeleton />
            ) : events.length ? (
                <Grid events={events} />
            ) : (
                !loading && !clubs.length && !people.length && <EmptyState icon={debounced ? Search : CalendarDays} title={debounced ? "No results" : "No events yet"} />
            )}
        </div>
    );
};

export default ExplorePage;
