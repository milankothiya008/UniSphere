import { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, ChevronDown } from "lucide-react";
import { googleCalendarUrl, icsDataUrl, safeFileName } from "../../lib/calendar";

/**
 * "Add to calendar" with a small menu: Google Calendar, or an .ics file for Apple Calendar / Outlook.
 * `item`: { title, start, end, details, location, uid }. `icsUrl`: a server-made .ics (public events);
 * without it the file is made here.
 */
export const AddToCalendar = ({ item, icsUrl = null, size = "sm", variant = "secondary", label = "Add to calendar" }) => {
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
            if (event.type === "keydown" ? event.key === "Escape" : !boxRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

    if (!item?.start || !item?.end) return null;
    const file = icsUrl || icsDataUrl(item);

    return (
        <div className="cal-add" ref={boxRef}>
            <button
                type="button"
                className={`btn btn-${variant} btn-${size}`}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen((value) => !value)}
            >
                <CalendarPlus size={15} /> {label} <ChevronDown size={14} />
            </button>
            {open && (
                <div className="cal-add-menu" role="menu" id={menuId}>
                    <a role="menuitem" href={googleCalendarUrl(item)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                        Google Calendar
                    </a>
                    <a role="menuitem" href={file} download={safeFileName(item.title)} onClick={() => setOpen(false)}>
                        Apple Calendar / Outlook (.ics)
                    </a>
                </div>
            )}
        </div>
    );
};
