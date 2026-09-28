import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BadgeCheck, CalendarDays, Expand, Mail, MapPin, Ticket, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { formatDate, formatDateTime, formatTimeRange } from "../../lib/format";
import { Avatar, Button, Modal, Skeleton } from "../ui";

// "CC-7K3M9QWA" → "CC-7K3M 9QWA", easier to read out at the door.
export const spacedCode = (code) => (code ? code.replace(/^(CC-[A-Z2-9]{4})([A-Z2-9]{4})$/, "$1 $2") : "");

const TicketBody = ({ ticket, large = false }) => (
    <div className={`ticket ${ticket.checkedInAt ? "is-checked" : ""} ${large ? "is-large" : ""}`}>
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
            <p className="ticket-note">
                {ticket.checkedInAt ? (
                    <>
                        <BadgeCheck size={14} /> Checked in at {formatDateTime(ticket.checkedInAt)}
                    </>
                ) : (
                    "Show this QR code at the entrance, or read out the ticket code."
                )}
            </p>
        </div>
    </div>
);

/** The signed-in student's ticket for an event: QR code, ticket number and event details. */
export const TicketCard = ({ event, registration, onLoaded }) => {
    const [params, setParams] = useSearchParams();
    const [fullScreen, setFullScreen] = useState(false);
    const { data: ticket, loading, error } = useApi(() => eventApi.ticket(event._id), [event._id, registration?.checkedInAt, registration?.ticketCode]);

    // Ticket emails link here with ?ticket=1 so the QR opens straight away.
    useEffect(() => {
        if (params.get("ticket") === "1") {
            setFullScreen(true);
            params.delete("ticket");
            setParams(params, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    useEffect(() => {
        if (ticket) {
            onLoaded?.(ticket);
        }
    }, [ticket, onLoaded]);

    if (loading && !ticket) {
        return (
            <div className="ticket is-loading" aria-busy="true">
                <Skeleton height={220} />
                <Skeleton height={16} width="60%" style={{ marginTop: 12 }} />
            </div>
        );
    }
    if (error || !ticket) {
        return null;
    }

    return (
        <div className="ticket-card">
            <TicketBody ticket={ticket} />
            <div className="ticket-actions">
                <Button variant="secondary" size="sm" onClick={() => setFullScreen(true)}>
                    <Expand size={15} /> Show full screen
                </Button>
                <span className="subtle small">
                    <Mail size={13} /> Also sent to {ticket.holder.email}
                </span>
            </div>

            <Modal open={fullScreen} onClose={() => setFullScreen(false)} title="Your ticket" description="Turn up the brightness and hold the QR code steady for the scanner.">
                <div className="ticket-modal">
                    <TicketBody ticket={ticket} large />
                </div>
            </Modal>
        </div>
    );
};
