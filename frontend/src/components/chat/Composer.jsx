import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Image, Mic, Paperclip, Pencil, Plus, Reply, Send, Smile, Trash2, X } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { ActionMenu } from "../ui";
import { ACCEPT_DOCUMENTS, ACCEPT_GALLERY, EMOJI_SETS, LIMITS, classify, duration, fileSize, uploadChatFile } from "../../lib/chat";

let nextKey = 0;

/** Emoji grid for desktops (phones have their own emoji keyboard). */
const EmojiPicker = ({ onPick, onClose }) => {
    const [set, setSet] = useState(0);
    const box = useRef(null);
    useEffect(() => {
        const onDown = (event) => !box.current?.contains(event.target) && onClose();
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [onClose]);
    return (
        <div className="emoji-picker" ref={box} role="dialog" aria-label="Emoji">
            <div className="emoji-tabs">
                {EMOJI_SETS.map(([name], index) => (
                    <button key={name} type="button" className={index === set ? "active" : ""} onClick={() => setSet(index)}>
                        {name}
                    </button>
                ))}
            </div>
            <div className="emoji-grid">
                {EMOJI_SETS[set][1].split(" ").map((emoji) => (
                    <button key={emoji} type="button" onClick={() => onPick(emoji)} aria-label={emoji}>
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
};

// Voice notes: the best format the browser can record (Opus in WebM on Chrome/Android, AAC in MP4 on Safari/iPhone).
const recorderFormat = () => {
    const options = [
        ["audio/webm;codecs=opus", "webm"],
        ["audio/mp4", "m4a"],
        ["audio/ogg;codecs=opus", "ogg"],
        ["audio/webm", "webm"]
    ];
    return options.find(([type]) => window.MediaRecorder?.isTypeSupported?.(type)) || null;
};

/**
 * Writing a message: text with emoji, photos/videos/documents (uploaded as soon as they're added), a camera
 * shortcut on phones, pasted images, voice notes, replying and editing.
 */
export const Composer = ({ conversationId, blockedReason, replyTo, onCancelReply, editing, onCancelEdit, onSend, onEditSave, onTyping, meId, dropped }) => {
    const toast = useToast();
    const [text, setText] = useState("");
    const [files, setFiles] = useState([]);
    const [emoji, setEmoji] = useState(false);
    const [recording, setRecording] = useState(null);
    const area = useRef(null);
    const galleryInput = useRef(null);
    const docInput = useRef(null);
    const cameraInput = useRef(null);
    const lastTyping = useRef(0);

    useEffect(() => {
        if (editing) {
            setText(editing.text);
            area.current?.focus();
        }
    }, [editing]);
    useEffect(() => {
        if (replyTo) area.current?.focus();
    }, [replyTo]);
    // A new chat starts with an empty box.
    useEffect(() => {
        setText("");
        setFiles([]);
    }, [conversationId]);

    // Grow with the text, up to about six lines.
    useEffect(() => {
        const element = area.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
    }, [text]);

    const addFiles = (list) => {
        const picked = [...list].slice(0, 10 - files.length);
        picked.forEach((file) => {
            const info = classify(file);
            if (info.error) {
                toast.error(info.error);
                return;
            }
            const key = ++nextKey;
            const preview = info.kind === "DOCUMENT" ? null : URL.createObjectURL(file);
            setFiles((current) => [...current, { key, file, kind: info.kind, ext: info.ext, preview, progress: 0, media: null, error: null }]);
            uploadChatFile(conversationId, file, {
                kind: info.kind,
                ext: info.ext,
                onProgress: (progress) => setFiles((current) => current.map((item) => (item.key === key ? { ...item, progress } : item)))
            })
                .then((media) => setFiles((current) => current.map((item) => (item.key === key ? { ...item, media, progress: 1 } : item))))
                .catch((error) =>
                    setFiles((current) => current.map((item) => (item.key === key ? { ...item, error: error.message || "Upload failed" } : item)))
                );
        });
    };

    useEffect(() => {
        if (dropped?.files?.length) addFiles(dropped.files);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dropped]);

    const removeFile = (key) =>
        setFiles((current) => {
            const item = current.find((entry) => entry.key === key);
            if (item?.preview) URL.revokeObjectURL(item.preview);
            return current.filter((entry) => entry.key !== key);
        });

    const uploading = files.some((item) => !item.media && !item.error);
    const ready = files.filter((item) => item.media);
    const canSend = !blockedReason && !uploading && (text.trim() || ready.length) && !files.some((item) => item.error);

    const submit = async (event) => {
        event?.preventDefault();
        if (editing) {
            if (text.trim() || editing.hasFiles) await onEditSave(text.trim());
            setText("");
            return;
        }
        if (!canSend) return;
        const body = {
            text: text.trim(),
            attachments: ready.map((item) => item.media),
            previews: ready.map((item) => ({ kind: item.kind, url: item.preview, name: item.file.name, bytes: item.file.size, format: item.ext }))
        };
        setText("");
        setFiles([]);
        onSend(body);
    };

    const onKeyDown = (event) => {
        // Enter sends on computers; Shift+Enter (and Enter on phones) adds a line.
        const coarse = window.matchMedia?.("(pointer: coarse)").matches;
        if (event.key === "Enter" && !event.shiftKey && !coarse && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
        }
        if (event.key === "Escape") {
            if (editing) onCancelEdit();
            else if (replyTo) onCancelReply();
        }
    };

    const onChange = (event) => {
        setText(event.target.value);
        if (Date.now() - lastTyping.current > 2500) {
            lastTyping.current = Date.now();
            onTyping?.();
        }
    };

    const onPaste = (event) => {
        const pasted = [...(event.clipboardData?.files || [])];
        if (pasted.length) {
            event.preventDefault();
            addFiles(pasted);
        }
    };

    // ------------------------------------------------------------ Voice notes

    const startRecording = async () => {
        const format = recorderFormat();
        if (!format || !navigator.mediaDevices?.getUserMedia) {
            toast.error("This browser can't record voice messages");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: format[0] });
            const chunks = [];
            recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
            const started = Date.now();
            const state = { recorder, stream, chunks, started, format, seconds: 0, cancelled: false };
            state.timer = setInterval(() => {
                state.seconds = Math.floor((Date.now() - started) / 1000);
                setRecording((current) => (current ? { ...current, seconds: state.seconds } : current));
                onTyping?.({ recording: true });
                if (state.seconds >= 600) stopRecording(true);
            }, 1000);
            recorder.start(250);
            setRecording(state);
        } catch {
            toast.error("Allow microphone access to record a voice message");
        }
    };

    const stopRecording = (send) => {
        setRecording((state) => {
            if (!state) return null;
            clearInterval(state.timer);
            state.recorder.onstop = async () => {
                state.stream.getTracks().forEach((track) => track.stop());
                if (!send) return;
                const seconds = Math.max(1, Math.round((Date.now() - state.started) / 1000));
                const blob = new Blob(state.chunks, { type: state.format[0].split(";")[0] });
                if (blob.size > LIMITS.AUDIO * 1024 * 1024) {
                    toast.error("That voice message is too long");
                    return;
                }
                const file = new File([blob], `voice-message.${state.format[1]}`, { type: blob.type });
                try {
                    const media = await uploadChatFile(conversationId, file, { kind: "AUDIO", ext: state.format[1], details: { duration: seconds } });
                    onSend({
                        text: "",
                        attachments: [{ ...media, duration: seconds }],
                        previews: [{ kind: "AUDIO", url: URL.createObjectURL(blob), duration: seconds }]
                    });
                } catch (error) {
                    toast.error(error);
                }
            };
            state.recorder.stop();
            return null;
        });
    };

    useEffect(() => () => recording && stopRecording(false), []); // eslint-disable-line react-hooks/exhaustive-deps

    if (blockedReason) {
        return <div className="composer composer-blocked">{blockedReason}</div>;
    }

    const attachMenu = [
        { label: "Photos & videos", icon: Image, onClick: () => galleryInput.current?.click() },
        { label: "Camera", icon: Camera, onClick: () => cameraInput.current?.click() },
        { label: "Document", icon: FileText, onClick: () => docInput.current?.click() }
    ];

    return (
        <form className="composer" onSubmit={submit}>
            {(replyTo || editing) && (
                <div className="composer-context">
                    {editing ? <Pencil size={16} /> : <Reply size={16} />}
                    <span>
                        <strong>
                            {editing ? "Editing message" : `Replying to ${replyTo.sender?._id === meId ? "yourself" : replyTo.sender?.name || "message"}`}
                        </strong>
                        <span>{editing ? editing.text : replyTo.text || replyTo.preview}</span>
                    </span>
                    <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                            if (editing) {
                                setText("");
                                onCancelEdit();
                            } else onCancelReply();
                        }}
                        aria-label="Cancel"
                    >
                        <X size={18} />
                    </button>
                </div>
            )}

            {files.length > 0 && (
                <div className="composer-files">
                    {files.map((item) => (
                        <div key={item.key} className={`composer-file ${item.error ? "has-error" : ""}`} title={item.error || item.file.name}>
                            {item.kind === "IMAGE" ? (
                                <img src={item.preview} alt="" />
                            ) : item.kind === "VIDEO" ? (
                                <video src={item.preview} muted />
                            ) : (
                                <span className="composer-doc">
                                    <FileText size={20} />
                                    <small>{item.file.name}</small>
                                    <small className="subtle">{fileSize(item.file.size)}</small>
                                </span>
                            )}
                            {!item.media && !item.error && (
                                <span className="composer-progress">
                                    <i style={{ width: `${Math.round(item.progress * 100)}%` }} />
                                </span>
                            )}
                            {item.error && <span className="composer-error">Failed</span>}
                            <button type="button" className="composer-file-remove" onClick={() => removeFile(item.key)} aria-label={`Remove ${item.file.name}`}>
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                    {files.length < 10 && (
                        <button type="button" className="composer-file composer-file-add" onClick={() => galleryInput.current?.click()} aria-label="Add more">
                            <Plus size={20} />
                        </button>
                    )}
                </div>
            )}

            {recording ? (
                <div className="composer-row composer-recording">
                    <button type="button" className="icon-button" onClick={() => stopRecording(false)} aria-label="Delete recording">
                        <Trash2 size={20} />
                    </button>
                    <span className="rec-dot" aria-hidden="true" />
                    <span className="rec-time">{duration(recording.seconds)}</span>
                    <span className="rec-hint subtle small">Recording…</span>
                    <button type="button" className="composer-send" onClick={() => stopRecording(true)} aria-label="Send voice message">
                        <Send size={18} />
                    </button>
                </div>
            ) : (
                <div className="composer-row">
                    <span className="composer-emoji">
                        <button type="button" className="icon-button" onClick={() => setEmoji((value) => !value)} aria-label="Emoji" aria-expanded={emoji}>
                            <Smile size={22} strokeWidth={1.8} />
                        </button>
                        {emoji && (
                            <EmojiPicker
                                onPick={(value) => {
                                    const element = area.current;
                                    const at = element?.selectionStart ?? text.length;
                                    setText((current) => current.slice(0, at) + value + current.slice(at));
                                    requestAnimationFrame(() => element?.focus());
                                }}
                                onClose={() => setEmoji(false)}
                            />
                        )}
                    </span>
                    <textarea
                        ref={area}
                        className="composer-input"
                        rows={1}
                        value={text}
                        onChange={onChange}
                        onKeyDown={onKeyDown}
                        onPaste={onPaste}
                        placeholder={editing ? "Edit message…" : "Message…"}
                        aria-label="Message"
                        maxLength={4000}
                    />
                    {!editing && (
                        <ActionMenu
                            items={attachMenu}
                            label="Attach"
                            align="right"
                            trigger={({ open, toggle, menuId }) => (
                                <button
                                    type="button"
                                    className="icon-button"
                                    onClick={toggle}
                                    aria-haspopup="menu"
                                    aria-expanded={open}
                                    aria-controls={open ? menuId : undefined}
                                    aria-label="Attach"
                                >
                                    <Paperclip size={21} strokeWidth={1.8} />
                                </button>
                            )}
                        />
                    )}
                    {text.trim() || files.length || editing ? (
                        <button
                            type="submit"
                            className="composer-send"
                            disabled={editing ? !text.trim() && !editing.hasFiles : !canSend}
                            aria-label={editing ? "Save" : "Send"}
                        >
                            <Send size={18} />
                        </button>
                    ) : (
                        <button type="button" className="composer-mic" onClick={startRecording} aria-label="Record voice message">
                            <Mic size={21} strokeWidth={1.8} />
                        </button>
                    )}
                </div>
            )}
            <input
                ref={galleryInput}
                type="file"
                accept={ACCEPT_GALLERY}
                multiple
                hidden
                onChange={(event) => (addFiles(event.target.files), (event.target.value = ""))}
            />
            <input
                ref={cameraInput}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                hidden
                onChange={(event) => (addFiles(event.target.files), (event.target.value = ""))}
            />
            <input
                ref={docInput}
                type="file"
                accept={ACCEPT_DOCUMENTS}
                multiple
                hidden
                onChange={(event) => (addFiles(event.target.files), (event.target.value = ""))}
            />
        </form>
    );
};
