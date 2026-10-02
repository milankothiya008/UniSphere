import { useEffect, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button, Modal } from "../ui";

const OUTPUT = 512; // px, square
const MAX_ZOOM = 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Keeps the photo covering the whole circle: it can't be dragged so far that an empty edge shows. */
const bound = (offset, image, frame, zoom) => {
    const scale = (frame / Math.min(image.width, image.height)) * zoom;
    const spareX = (image.width * scale - frame) / 2;
    const spareY = (image.height * scale - frame) / 2;
    return { x: clamp(offset.x, -spareX, spareX), y: clamp(offset.y, -spareY, spareY) };
};

/** The visible square as a 512×512 JPEG file. */
const exportCrop = (img, frame, zoom, offset) =>
    new Promise((resolve, reject) => {
        const scale = (frame / Math.min(img.naturalWidth, img.naturalHeight)) * zoom;
        const size = frame / scale;
        const sx = (img.naturalWidth * scale) / 2 - offset.x - frame / 2;
        const sy = (img.naturalHeight * scale) / 2 - offset.y - frame / 2;
        const canvas = document.createElement("canvas");
        canvas.width = OUTPUT;
        canvas.height = OUTPUT;
        const context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.fillStyle = "#fff";
        context.fillRect(0, 0, OUTPUT, OUTPUT);
        context.drawImage(img, sx / scale, sy / scale, size, size, 0, 0, OUTPUT, OUTPUT);
        canvas.toBlob(
            (blob) => (blob ? resolve(new File([blob], "profile-photo.jpg", { type: "image/jpeg" })) : reject(new Error("Couldn't prepare the photo"))),
            "image/jpeg",
            0.9
        );
    });

/**
 * Preview and crop a profile photo before it's uploaded: drag to position, zoom with the slider, mouse wheel
 * or a pinch, arrow keys to nudge. The circle shows exactly what others will see.
 */
export const PhotoCropDialog = ({ file, onClose, onCropped }) => {
    const imgRef = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    const [url, setUrl] = useState(null);
    const [natural, setNatural] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [saving, setSaving] = useState(false);
    const frame = Math.min(300, (typeof window !== "undefined" ? window.innerWidth : 400) - 88);

    useEffect(() => {
        if (!file) return undefined;
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        setNatural(null);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    const applyZoom = (next) => {
        const value = clamp(next, 1, MAX_ZOOM);
        setZoom(value);
        if (natural) setOffset((current) => bound(current, natural, frame, value));
    };
    const move = (dx, dy) => natural && setOffset((current) => bound({ x: current.x + dx, y: current.y + dy }, natural, frame, zoom));

    const onPointerDown = (event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        gesture.current = null;
    };
    const onPointerMove = (event) => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        const now = { x: event.clientX, y: event.clientY };
        pointers.current.set(event.pointerId, now);
        if (pointers.current.size === 1) {
            move(now.x - previous.x, now.y - previous.y);
            return;
        }
        // Two fingers: zoom by how much they spread.
        const [a, b] = [...pointers.current.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.current) applyZoom(zoom * (distance / gesture.current));
        gesture.current = distance;
    };
    const onPointerUp = (event) => {
        pointers.current.delete(event.pointerId);
        gesture.current = null;
    };
    const onKeyDown = (event) => {
        const step = event.shiftKey ? 20 : 6;
        const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (moves[event.key]) {
            event.preventDefault();
            move(...moves[event.key]);
        } else if (event.key === "+" || event.key === "=") applyZoom(zoom + 0.1);
        else if (event.key === "-") applyZoom(zoom - 0.1);
    };

    // A non-passive wheel listener, so zooming doesn't also scroll the page.
    const stageRef = useRef(null);
    const wheel = useRef(null);
    wheel.current = (event) => {
        event.preventDefault();
        applyZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
    };
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return undefined;
        const listener = (event) => wheel.current(event);
        stage.addEventListener("wheel", listener, { passive: false });
        return () => stage.removeEventListener("wheel", listener);
    }, [url]);

    const scale = natural ? (frame / Math.min(natural.width, natural.height)) * zoom : 1;
    const width = natural ? natural.width * scale : frame;
    const height = natural ? natural.height * scale : frame;

    const save = async () => {
        setSaving(true);
        try {
            onCropped(await exportCrop(imgRef.current, frame, zoom, offset));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={Boolean(file)}
            onClose={saving ? undefined : onClose}
            title="Adjust your photo"
            description="Drag to position it and zoom to fit. The circle is what everyone sees."
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={save} loading={saving} disabled={!natural}>
                        Use this photo
                    </Button>
                </>
            }
        >
            <div className="cropper">
                <div
                    ref={stageRef}
                    className="cropper-stage"
                    style={{ width: frame, height: frame }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={onKeyDown}
                    tabIndex={0}
                    role="application"
                    aria-label="Photo position. Use the arrow keys to move it and plus or minus to zoom."
                >
                    {url && (
                        <img
                            ref={imgRef}
                            src={url}
                            alt="Your new profile photo"
                            draggable={false}
                            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                            style={{ width, height, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`, opacity: natural ? 1 : 0 }}
                        />
                    )}
                    <span className="cropper-mask" aria-hidden="true" />
                </div>
                <div className="cropper-zoom">
                    <button type="button" className="btn-icon" onClick={() => applyZoom(zoom - 0.2)} aria-label="Zoom out" disabled={zoom <= 1}>
                        <ZoomOut size={18} />
                    </button>
                    <input
                        type="range"
                        min={1}
                        max={MAX_ZOOM}
                        step={0.01}
                        value={zoom}
                        onChange={(event) => applyZoom(Number(event.target.value))}
                        aria-label="Zoom"
                    />
                    <button type="button" className="btn-icon" onClick={() => applyZoom(zoom + 0.2)} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM}>
                        <ZoomIn size={18} />
                    </button>
                    <button
                        type="button"
                        className="btn-icon"
                        onClick={() => {
                            setZoom(1);
                            setOffset({ x: 0, y: 0 });
                        }}
                        aria-label="Reset"
                        title="Reset"
                    >
                        <RotateCcw size={17} />
                    </button>
                </div>
                {natural && (
                    <div className="cropper-previews" aria-hidden="true">
                        {[64, 40, 28].map((size) => (
                            <span key={size} className="cropper-preview" style={{ width: size, height: size }}>
                                <img
                                    src={url}
                                    alt=""
                                    style={{
                                        width: width * (size / frame),
                                        height: height * (size / frame),
                                        transform: `translate(calc(-50% + ${offset.x * (size / frame)}px), calc(-50% + ${offset.y * (size / frame)}px))`
                                    }}
                                />
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
};
