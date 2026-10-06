import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { calendarApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { Button, ConfirmDialog } from "../ui";

/**
 * The person's private calendar feed: every event they hold a place for and every interview slot, kept up to
 * date in Google Calendar, Apple Calendar or Outlook (changed times and cancellations follow by themselves).
 */
export const CalendarSync = () => {
    const toast = useToast();
    const [link, setLink] = useState(null);
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        calendarApi
            .link()
            .then((response) => setLink(response.data))
            .catch(() => {});
    }, []);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link.url);
            toast.success("Calendar link copied");
        } catch {
            toast.error("Couldn't copy — select the link and copy it");
        }
    };

    const reset = async () => {
        const response = await calendarApi.resetLink();
        setLink(response.data);
        toast.success("New calendar link made — the old one no longer works");
    };

    if (!link) return null;
    return (
        <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
                Your registered events and interview slots in your own calendar, kept up to date: if a time changes or an event is cancelled, your calendar
                changes too.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <a className="btn btn-primary btn-sm" href={link.google} target="_blank" rel="noreferrer">
                    Add to Google Calendar
                </a>
                <a className="btn btn-secondary btn-sm" href={link.webcal}>
                    Apple Calendar / Outlook
                </a>
                <Button size="sm" variant="ghost" onClick={copy}>
                    <Copy size={15} /> Copy link
                </Button>
            </div>
            <span className="subtle small">
                Keep this link private — anyone with it can see your schedule. Calendar apps check it every few hours. Reset it if you shared it by mistake.
            </span>
            <div>
                <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
                    <RefreshCw size={15} /> Reset link
                </Button>
            </div>
            <ConfirmDialog
                open={resetting}
                onClose={() => setResetting(false)}
                onConfirm={reset}
                title="Reset your calendar link?"
                description="Calendars using the current link stop updating. You'll need to add the new link again."
                confirmLabel="Reset link"
            />
        </div>
    );
};
