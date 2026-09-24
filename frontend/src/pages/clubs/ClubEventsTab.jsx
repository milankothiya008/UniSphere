import { useOutletContext } from "react-router-dom";
import { CalendarDays, Plus } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { EventCard } from "../../components/events/EventCard";
import { AsyncContent, ButtonLink, CardGridSkeleton, EmptyState, Pagination } from "../../components/ui";
import { PERMISSIONS, STATUS_STYLES } from "../../lib/constants";

const STAFF_STATUSES = ["", "DRAFT", "NEEDS_CHANGES", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "COMPLETED", "CANCELLED", "REJECTED"];

const ClubEventsTab = () => {
    const { club } = useOutletContext();
    const viewer = club.viewer || {};
    const canCreate = viewer.permissions?.includes(PERMISSIONS.MANAGE_EVENTS) && club.status === "ACTIVE";
    const [filters, setFilters] = useQueryState({ status: "", page: "1" });

    const { data, meta, loading, error, reload } = useApi(
        () => clubApi.events(club._id, { status: filters.status, page: filters.page, limit: 12 }),
        [club._id, filters.status, filters.page]
    );
    const isStaff = meta?.isStaff;

    return (
        <div className="stack">
            <div className="row-between">
                {isStaff ? (
                    <select className="select" style={{ width: "auto" }} value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} aria-label="Status">
                        {STAFF_STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {status ? STATUS_STYLES[status][0] : "All statuses"}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className="muted">Published and past events</span>
                )}
                {canCreate && (
                    <ButtonLink to={`/events/create?club=${club._id}`}>
                        <Plus size={16} /> Create event
                    </ButtonLink>
                )}
            </div>
            <AsyncContent
                loading={loading}
                error={error}
                onRetry={reload}
                isEmpty={!data?.length}
                skeleton={<CardGridSkeleton count={3} />}
                empty={<EmptyState icon={CalendarDays} title="No events yet" description={canCreate ? "Create the club's first event." : "This club hasn't published any events yet."} />}
            >
                <div className="grid-cards">
                    {data?.map((event) => (
                        <EventCard key={event._id} event={event} showStatus={isStaff} />
                    ))}
                </div>
                <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
            </AsyncContent>
        </div>
    );
};

export default ClubEventsTab;
