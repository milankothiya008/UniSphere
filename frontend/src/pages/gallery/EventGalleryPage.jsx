import { useParams } from "react-router-dom";
import { Images } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { AsyncContent, ButtonLink, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { EventGallery } from "../../components/gallery/EventGallery";
import { formatDateLong, formatTimeRange } from "../../lib/format";

/** One event's gallery: all its photos and videos, uploading, and the president's / VP's review queue. */
const EventGalleryPage = () => {
    const { eventId } = useParams();
    const { data: event, loading, error, reload } = useApi(() => eventApi.get(eventId), [eventId]);
    const open = event && ["PUBLISHED", "COMPLETED"].includes(event.status);

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {event && (
                <>
                    <PageHeader
                        back={{ to: "/gallery", label: "Gallery" }}
                        club={event.club}
                        title={event.title}
                        meta={[formatDateLong(event.startAt), formatTimeRange(event.startAt, event.endAt), event.venue?.name].filter(Boolean).join(" · ")}
                        actions={
                            <>
                                <StatusBadge status={event.status} />
                                <ButtonLink to={`/events/${event._id}`} variant="secondary" size="sm">
                                    Event details
                                </ButtonLink>
                            </>
                        }
                    />
                    {open ? (
                        <EventGallery event={event} />
                    ) : (
                        <Card>
                            <EmptyState icon={Images} title="The gallery opens once the event is published" description="Club members can add photos from then on, and checked-in participants once the event starts." />
                        </Card>
                    )}
                </>
            )}
        </AsyncContent>
    );
};

export default EventGalleryPage;
