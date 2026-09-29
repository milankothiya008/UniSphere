import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * The whole picture, never cropped: the image is contained in its frame and a soft blurred copy fills the
 * space around it. Use inside any positioned box with a fixed shape (a card cover, a poster frame).
 */
export const MediaFill = ({ src, alt = "", loading = "lazy", onLoad }) => (
    <>
        <span className="media-fill" style={{ "--media": `url("${String(src).replace(/"/g, "%22")}")` }} aria-hidden="true" />
        <img
            className="media-img"
            src={src}
            alt={alt}
            loading={loading}
            decoding="async"
            onLoad={(event) => {
                event.currentTarget.classList.add("is-loaded");
                onLoad?.(event);
            }}
        />
    </>
);

// ---------------------------------------------------------------- Full-screen viewer

const LightboxContext = createContext(null);

const Viewer = ({ item, onClose }) => {
    const [zoomed, setZoomed] = useState(false);
    const [origin, setOrigin] = useState("50% 50%");
    const closeRef = useRef(null);

    useEffect(() => {
        const onKey = (event) => event.key === "Escape" && onClose();
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        closeRef.current?.focus();
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [onClose]);

    const toggleZoom = (event) => {
        if (item.type === "video") return;
        const box = event.currentTarget.getBoundingClientRect();
        setOrigin(`${((event.clientX - box.left) / box.width) * 100}% ${((event.clientY - box.top) / box.height) * 100}%`);
        setZoomed((value) => !value);
    };

    return createPortal(
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.alt || "Media viewer"} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div className="lightbox-bar">
                {item.caption && <span className="lightbox-caption">{item.caption}</span>}
                <span className="lightbox-tools">
                    {item.type !== "video" && (
                        <button type="button" onClick={() => setZoomed((value) => !value)} aria-label={zoomed ? "Zoom out" : "Zoom in"}>
                            {zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
                        </button>
                    )}
                    <a href={item.src} target="_blank" rel="noreferrer" aria-label="Open original">
                        <Download size={18} />
                    </a>
                    <button type="button" ref={closeRef} onClick={onClose} aria-label="Close">
                        <X size={20} />
                    </button>
                </span>
            </div>
            <div className="lightbox-stage" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
                {item.type === "video" ? (
                    <video src={item.src} poster={item.poster} controls autoPlay playsInline className="lightbox-media" />
                ) : (
                    <img
                        src={item.src}
                        alt={item.alt || ""}
                        className={`lightbox-media ${zoomed ? "is-zoomed" : ""}`}
                        style={{ transformOrigin: origin }}
                        onClick={toggleZoom}
                        draggable={false}
                    />
                )}
            </div>
        </div>,
        document.body
    );
};

export const LightboxProvider = ({ children }) => {
    const [item, setItem] = useState(null);
    const open = useCallback((next) => setItem(next), []);
    const close = useCallback(() => setItem(null), []);
    return (
        <LightboxContext.Provider value={open}>
            {children}
            {item && <Viewer item={item} onClose={close} />}
        </LightboxContext.Provider>
    );
};

/** open({ src, alt, caption, type: "image" | "video", poster }) shows the media full screen. */
export const useLightbox = () => {
    const open = useContext(LightboxContext);
    return open || ((item) => window.open(item.src, "_blank", "noopener"));
};

/** A framed picture that opens full screen when clicked. */
export const ZoomableMedia = ({ src, alt = "", caption, className = "", children }) => {
    const open = useLightbox();
    return (
        <button type="button" className={`zoomable ${className}`} onClick={() => open({ src, alt, caption, type: "image" })} aria-label={`View ${alt || "image"} full size`}>
            <MediaFill src={src} alt={alt} />
            <span className="zoomable-hint" aria-hidden="true">
                <ZoomIn size={16} /> View full size
            </span>
            {children}
        </button>
    );
};
