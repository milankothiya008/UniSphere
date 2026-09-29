import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

const GAP = 6;
const EDGE = 8;

/**
 * A "⋯" button that opens a small menu, so secondary actions don't need buttons of their own.
 * `items`: [{ label, icon: Icon, onClick, danger, disabled, hidden }] or "divider".
 * The menu is drawn above the page (in a portal) so tables and cards can't clip it; it opens upwards
 * when there's no room below.
 */
export const ActionMenu = ({ items, label = "More actions", align = "right", trigger, className = "" }) => {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const boxRef = useRef(null);
    const menuRef = useRef(null);
    const menuId = useId();
    const visible = items.filter((item) => item && !item.hidden);

    const close = (refocus = false) => {
        setOpen(false);
        setPosition(null);
        if (refocus) boxRef.current?.querySelector("button")?.focus();
    };

    // Place the menu under (or above) its button, inside the viewport.
    const place = () => {
        if (!menuRef.current || !boxRef.current) return;
        const anchor = boxRef.current.getBoundingClientRect();
        if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
            close();
            return;
        }
        const menu = menuRef.current.getBoundingClientRect();
        const below = anchor.bottom + GAP + menu.height <= window.innerHeight - EDGE;
        const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - menu.height);
        const preferred = align === "left" ? anchor.left : anchor.right - menu.width;
        const left = Math.min(Math.max(EDGE, preferred), window.innerWidth - menu.width - EDGE);
        setPosition({ top, left, origin: `${below ? "top" : "bottom"} ${align === "left" ? "left" : "right"}` });
    };
    useLayoutEffect(() => {
        if (open) place();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, align]);

    useEffect(() => {
        if (!open) return undefined;
        const onPointer = (event) => {
            if (!boxRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close();
        };
        const onKey = (event) => {
            if (event.key === "Escape") close(true);
            if (["ArrowDown", "ArrowUp"].includes(event.key) && menuRef.current) {
                event.preventDefault();
                const buttons = [...menuRef.current.querySelectorAll("[role=menuitem]:not(:disabled)")];
                const index = buttons.indexOf(document.activeElement);
                buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
        };
        // The menu is fixed to the screen: it follows its button while the page scrolls.
        const onMove = (event) => !menuRef.current?.contains(event.target) && place();
        document.addEventListener("mousedown", onPointer);
        document.addEventListener("keydown", onKey);
        window.addEventListener("scroll", onMove, true);
        window.addEventListener("resize", onMove);
        return () => {
            document.removeEventListener("mousedown", onPointer);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", onMove, true);
            window.removeEventListener("resize", onMove);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (position) menuRef.current?.querySelector("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
    }, [position]);

    if (!visible.some((item) => item !== "divider")) {
        return null;
    }
    const toggle = () => (open ? close() : setOpen(true));

    return (
        <div className={`action-menu ${className}`} ref={boxRef}>
            {trigger ? (
                trigger({ open, toggle, menuId })
            ) : (
                <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    aria-label={label}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-controls={open ? menuId : undefined}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggle();
                    }}
                >
                    <MoreHorizontal size={17} />
                </button>
            )}
            {open &&
                createPortal(
                    <div
                        ref={menuRef}
                        id={menuId}
                        className={`popover action-menu-list ${position ? "is-placed" : ""}`}
                        role="menu"
                        aria-label={label}
                        style={position ? { top: position.top, left: position.left, transformOrigin: position.origin } : { top: 0, left: 0 }}
                    >
                        {visible.map((item, index) => {
                            if (item === "divider") return <div key={`d${index}`} className="menu-divider" />;
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.label}
                                    type="button"
                                    role="menuitem"
                                    className={`menu-item ${item.danger ? "is-danger" : ""}`}
                                    disabled={item.disabled}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        close();
                                        item.onClick();
                                    }}
                                >
                                    {Icon && <Icon size={16} />} {item.label}
                                </button>
                            );
                        })}
                    </div>,
                    document.body
                )}
        </div>
    );
};
