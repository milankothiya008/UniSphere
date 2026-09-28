import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BadgeCheck, CalendarDays, Mail, MapPin, QrCode, Ticket, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { formatDate, formatDateTime, formatTimeRange } from "../../lib/format";
import { Avatar, Button, ErrorState, Modal, Skeleton } from "../ui";

// "CC-7K3M9QWA" → "CC-7K3M 9QWA", easier to read out at the door.
export const spacedCode = (code) => (code ? code.replace(/^(CC-[A-Z2-9]{4})([A-Z2-9]{4})$/, "$1 $2") : "");

const TicketBody = ({ ticket }) => (
    <div className={`ticket ${ticket.checkedInAt ? "is-checked" : ""}`}>
        <div className="ticket-head">
            <Avatar name={ticket.event.club?.name} src={ticket.event.club?.logo} size="sm" square />
            <div className="grow">
                <span className="ticket-club">{ticket.event.club?.name}</span>
                <strong className="ticket-title">{ticket.event.title}</strong>
            </div>
            <span className="ticket-stub">
                <Ticket size={15} /> Ticket
            </span>
        </div>

        <div className="ticket-qr">
            <img src={ticket.qrDataUrl} alt={`QR ticket ${ticket.ticketCode}`} draggable={false} />
            {ticket.checkedInAt && (
                <span className="ticket-checked-stamp">
                    <BadgeCheck size={18} /> Checked in
                </span>
            )}
        </div>

        <div className="ticket-perforation" aria-hidden="true" />

        <div className="ticket-details">
            <div className="ticket-code" aria-label={`Ticket code ${ticket.ticketCode}`}>
                <small>Ticket code</small>
                <b>{spacedCode(ticket.ticketCode)}</b>
            </div>
            <dl className="ticket-meta">
                <div>
                    <dt>Name</dt>
                    <dd>{ticket.holder.name}</dd>
                </div>
                {ticket.team && (
                    <div>
                        <dt>Team</dt>
                        <dd>
                            <Users size={13} /> {ticket.team.name}
                            {ticket.team.role === "LEADER" ? " · leader" : ""}
                        </dd>
                    </div>
                )}
                <div>
                    <dt>When</dt>
                    <dd>
                        <CalendarDays size={13} /> {formatDate(ticket.event.startAt)} · {formatTimeRange(ticket.event.startAt, ticket.event.endAt)}
                    </dd>
                </div>
                {ticket.event.venue && (
                    <div>
                        <dt>Where</dt>
                        <dd>
                            <MapPin size={13} /> {ticket.event.venue.name}
                            {ticket.event.venue.location ? `, ${ticket.event.venue.location}` : ""}
                        </dd>
                    </div>
                )}
            </dl>
            {ticket.checkedInAt && (
                <p className="ticket-note">
                    <BadgeCheck size={14} /> Checked in at {formatDateTime(ticket.checkedInAt)}
                </p>
            )}
        </div>
    </div>
);

// Mounted only while the window is open, so the QR is fetched when the student asks for it.
const TicketContent = ({ eventId }) => {
    const { data: ticket, loading, error, reload } = useApi(() => eventApi.ticket(eventId), [eventId]);

    if (loading && !ticket) {
        return (
            <div className="ticket is-loading" aria-busy="true">
                <Skeleton height={260} />
                <Skeleton height={16} width="60%" style={{ marginTop: 12 }} />
            </div>
        );
    }
    if (error || !ticket) {
        return <ErrorState error={error} title="Couldn't load your ticket" onRetry={reload} />;
    }
    return (
        <>
            <TicketBody ticket={ticket} />
            <p className="ticket-sent subtle small">
                <Mail size={13} /> A copy was sent to {ticket.holder.email}
            </p>
        </>
    );
};

/** One button on the event page; the ticket (QR code, code and details) opens in a window. */
export const TicketButton = ({ event, registration }) => {
    const [params, setParams] = useSearchParams();
    const [open, setOpen] = useState(false);
    const checkedIn = Boolean(registration?.checkedInAt);

    // Ticket emails link here with ?ticket=1 so the QR opens straight away.
    useEffect(() => {
        if (params.get("ticket") === "1") {
            setOpen(true);
            params.delete("ticket");
            setParams(params, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    return (
        <>
            <Button size="lg" block variant={checkedIn ? "secondary" : "primary"} onClick={() => setOpen(true)}>
                {checkedIn ? <BadgeCheck size={17} /> : <QrCode size={17} />} View ticket
            </Button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Your ticket"
                description={checkedIn ? "You're checked in for this event." : "Show this QR code at the entrance. Turn up your screen brightness for a faster scan."}
            >
                <div className="ticket-modal">
                    <TicketContent eventId={event._id} />
                </div>
            </Modal>
        </>
    );
};
