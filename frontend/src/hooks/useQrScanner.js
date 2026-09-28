import { useCallback, useEffect, useRef, useState } from "react";

// Reads QR codes from the device camera. Uses the browser's own BarcodeDetector when it has one
// (Chrome/Edge on Android and desktop, Safari 17+), otherwise the small jsQR decoder, loaded only
// when needed. The camera starts from a user action (phones require it) and stops when the page
// is hidden or the component goes away.
//
// state: idle | starting | scanning | denied | unsupported | insecure | error

const SCAN_INTERVAL_MS = 125;
const REPEAT_IGNORE_MS = 5000;
const MAX_FRAME = 640;

export const cameraSupported = () =>
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== "undefined";

export const useQrScanner = ({ onDecode, enabled = true }) => {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const canvasRef = useRef(null);
    const lastRef = useRef({ text: null, at: 0 });
    const onDecodeRef = useRef(onDecode);
    onDecodeRef.current = onDecode;
    const [state, setState] = useState("idle");
    const [error, setError] = useState(null);

    const stop = useCallback(() => {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setState((current) => (current === "scanning" || current === "starting" ? "idle" : current));
    }, []);

    // The current camera frame as a small JPEG, so the result can be shown over a frozen picture.
    const snapshot = useCallback(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth) {
            return null;
        }
        try {
            const scale = Math.min(1, MAX_FRAME / Math.max(video.videoWidth, video.videoHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/jpeg", 0.6);
        } catch {
            return null;
        }
    }, []);

    const handleHit = (text) => {
        const now = Date.now();
        if (text === lastRef.current.text && now - lastRef.current.at < REPEAT_IGNORE_MS) {
            return;
        }
        lastRef.current = { text, at: now };
        onDecodeRef.current?.(text);
    };

    const start = useCallback(async () => {
        if (!cameraSupported()) {
            setState(window.isSecureContext === false ? "insecure" : "unsupported");
            return;
        }
        setState("starting");
        setError(null);
        lastRef.current = { text: null, at: 0 };
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            streamRef.current = stream;
            const video = videoRef.current;
            if (!video) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            video.srcObject = stream;
            await video.play();

            let detector = null;
            let jsQR = null;
            if (typeof window.BarcodeDetector === "function") {
                try {
                    detector = new window.BarcodeDetector({ formats: ["qr_code"] });
                } catch {
                    detector = null;
                }
            }
            if (!detector) {
                jsQR = (await import("jsqr")).default;
            }
            setState("scanning");

            const tick = async () => {
                if (!streamRef.current || !videoRef.current || videoRef.current.readyState < 2) {
                    timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
                    return;
                }
                try {
                    if (detector) {
                        const codes = await detector.detect(videoRef.current);
                        if (codes[0]?.rawValue) {
                            handleHit(codes[0].rawValue);
                        }
                    } else {
                        const source = videoRef.current;
                        const scale = Math.min(1, MAX_FRAME / Math.max(source.videoWidth, source.videoHeight));
                        const width = Math.round(source.videoWidth * scale);
                        const height = Math.round(source.videoHeight * scale);
                        if (!canvasRef.current) {
                            canvasRef.current = document.createElement("canvas");
                        }
                        const canvas = canvasRef.current;
                        canvas.width = width;
                        canvas.height = height;
                        const context = canvas.getContext("2d", { willReadFrequently: true });
                        context.drawImage(source, 0, 0, width, height);
                        const image = context.getImageData(0, 0, width, height);
                        const code = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
                        if (code?.data) {
                            handleHit(code.data);
                        }
                    }
                } catch {
                    // A dropped frame is fine; keep scanning.
                }
                if (streamRef.current) {
                    timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
                }
            };
            timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
        } catch (err) {
            stop();
            if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
                setState("denied");
            } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
                setState("unsupported");
            } else {
                setState("error");
                setError(err?.message || "The camera could not be started");
            }
        }
    }, [stop]);

    useEffect(() => {
        if (!enabled) {
            stop();
        }
    }, [enabled, stop]);

    useEffect(() => {
        const onVisibility = () => document.visibilityState === "hidden" && stop();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            stop();
        };
    }, [stop]);

    return { videoRef, state, error, start, stop, snapshot, supported: cameraSupported() };
};
