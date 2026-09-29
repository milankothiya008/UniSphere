import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Hourglass, Images, Play } from "lucide-react";
import { galleryApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useDebounce } from "../../hooks/useDebounce";
import { AsyncContent, Avatar, EmptyState, PageHeader, Pagination, SearchInput, Segmented, Skeleton, MediaFill } from "../../components/ui";
import { CategoryArt } from "../../components/events/EventCard";
import { categoryVars } from "../../lib/eventVisuals";
import { formatDate, plural, timeAgo } from "../../lib/format";

const countLabel = (card) => [card.photos && plural(card.photos, "photo"), card.videos && plural(card.videos, "video")].filter(Boolean).join(" · ");

// The card's picture: a collage of the latest photos when there are a few, else one cover, the poster, or artwork.
const Cover = ({ card }) => {
    const { event } = card;
    if (card.previews.length >= 3) {
        return (
            <div className="gallery-card-collage">
                {card.previews.slice(0, 3).map((src, index) => (
                    <img key={src} src={src} alt="" loading="lazy" className={index === 0 ? "is-main" : ""} />
                ))}
            </div>
        );
    }
    const src = card.cover || event.poster;
    return src ? (
        <MediaFill src={src} />
    ) : (
        <div className="result-card-placeholder">
            <CategoryArt category={event.category} size={150} />
        </div>
    );
};

const GalleryCard = ({ card, index }) => {
    const { event } = card;
    const total = card.photos + card.videos;

    return (
        <Link to={`/gallery/${event._id}`} className="card card-link result-card gallery-card" style={{ "--i": Math.min(index, 8) }}>
            <div className="result-card-media gallery-card-media" style={categoryVars(event.category)}>
                <Cover card={card} />
                <div className="gallery-card-chips">
                    {total > 0 ? (
                        <span className="gallery-card-chip">
                            {card.videos > 0 && !card.photos ? <Play size={12} fill="currentColor" /> : <Images size={13} />} {countLabel(card)}
                        </span>
                    ) : (
                        <span className="gallery-card-chip is-empty">No photos yet</span>
                    )}
                    {card.pending > 0 && (
                        <span className="gallery-card-chip is-review">
                            <Hourglass size={12} /> {card.pending} to review
                        </span>
                    )}
                </div>
            </div>
            <div className="result-card-body">
                <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
                    <Avatar name={event.club?.name} src={event.club?.logo} size="sm" square />
                    <span className="subtle result-card-club">{event.club?.name}</span>
                </div>
                <h3>{event.title}</h3>
                <span className="subtle row" style={{ gap: 6 }}>
                    <CalendarDays size={13} /> {formatDate(event.startAt)}
                </span>
                <div className="result-card-foot">
                    <span className="subtle">{card.latestAt ? `Updated ${timeAgo(card.latestAt)}` : "Be the first to share"}</span>
                    <span className="result-card-cta">
                        Open gallery <ChevronRight size={15} />
                    </span>
                </div>
            </div>
        </Link>
    );
};

/** The Gallery section: every published event's photos and videos, one card per event. */
const GalleryPage = () => {
    const [filters, setFilters] = useQueryState({ show: "all", search: "", page: "1" });
    const search = useDebounce(filters.search, 300);
    const { data, meta, loading, error, reload } = useApi(
        () => galleryApi.events({ show: filters.show === "all" ? undefined : filters.show, search: search || undefined, page: filters.page, limit: 12 }),
        [filters.show, search, filters.page]
    );
    const counts = meta?.counts;
    const options = [
        { value: "all", label: `All events${counts ? ` (${counts.all})` : ""}` },
        { value: "photos", label: `With photos${counts ? ` (${counts.photos})` : ""}` },
        ...(meta?.canReview || filters.show === "review" ? [{ value: "review", label: `To review${counts ? ` (${counts.review})` : ""}` }] : [])
    ];

    return (
        <>
            <PageHeader
                eyebrow={
                    <>
                        <Images size={14} /> Gallery
                    </>
                }
                title="Event gallery"
                description="Photos and videos from club events, shared by members and participants. Pick an event to see its gallery or add yours."
            />
            <div className="stack">
                <div className="filter-bar">
                    <Segmented label="Show" value={filters.show} onChange={(show) => setFilters({ show, page: "1" })} options={options} />
                    <SearchInput value={filters.search} onChange={(value) => setFilters({ search: value, page: "1" })} placeholder="Search events…" />
                </div>
                <AsyncContent
                    loading={loading}
                    error={error}
                    onRetry={reload}
                    isEmpty={!data?.length}
                    skeleton={
                        <div className="result-grid">
                            {[1, 2, 3, 4, 5, 6].map((key) => (
                                <Skeleton key={key} height={300} style={{ borderRadius: 14 }} />
                            ))}
                        </div>
                    }
                    empty={
                        <EmptyState
                            icon={Images}
                            title={filters.search ? "No events match your search" : filters.show === "review" ? "Nothing waiting for review" : filters.show === "photos" ? "No photos shared yet" : "No events yet"}
                            description={filters.show === "review" ? "New uploads from members and participants will show up here." : "Galleries fill up as members and checked-in participants share their photos."}
                        />
                    }
                >
                    <div className="result-grid">
                        {data?.map((card, index) => (
                            <GalleryCard key={card.event._id} card={card} index={index} />
                        ))}
                    </div>
                    <div style={{ marginTop: 16 }}>
                        <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
                    </div>
                </AsyncContent>
            </div>
        </>
    );
};

export default GalleryPage;
