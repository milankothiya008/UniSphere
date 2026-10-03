import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCheck, ChevronLeft, Trash2 } from "lucide-react";
import { Avatar, Modal } from "../ui";
import { MUTE_OPTIONS, mutedLabel } from "../../lib/chat";

/**
 * What a long-press (phone), right-click or "…" (computer) on a chat offers, like Instagram:
 * mute or unmute messages, mark as read, delete / clear the chat.
 */
export const ChatOptionsSheet = ({ row, onClose, onMute, onRead, onClear }) => {
    const [step, setStep] = useState("main");
    useEffect(() => setStep("main"), [row]);
    if (!row) return null;

    const close = () => {
        setStep("main");
        onClose();
    };

    return (
        <Modal open={Boolean(row)} onClose={close} title={step === "mute" ? "Mute messages" : row.title} size="sm">
            {step === "main" ? (
                <div className="sheet-list">
                    <div className="sheet-who">
                        <Avatar name={row.title} src={row.avatar} size="lg" square={row.type === "CLUB"} />
                        {row.muted && <span className="subtle small">{mutedLabel(row.mutedUntil)}</span>}
                    </div>
                    {row.muted ? (
                        <button type="button" className="sheet-item" onClick={() => (onMute(row, null), close())}>
                            <Bell size={20} /> Unmute messages
                        </button>
                    ) : (
                        <button type="button" className="sheet-item" onClick={() => setStep("mute")}>
                            <BellOff size={20} /> Mute messages
                        </button>
                    )}
                    {row.unread > 0 && (
                        <button type="button" className="sheet-item" onClick={() => (onRead(row), close())}>
                            <CheckCheck size={20} /> Mark as read
                        </button>
                    )}
                    <button type="button" className="sheet-item is-danger" onClick={() => (onClear(row), close())}>
                        <Trash2 size={20} /> {row.type === "DIRECT" ? "Delete chat" : "Clear chat"}
                    </button>
                </div>
            ) : (
                <div className="sheet-list">
                    <p className="subtle small" style={{ margin: "0 0 6px" }}>
                        You won't get notifications for new messages. {row.type === "DIRECT" ? `${row.title.split(" ")[0]} won't know.` : "Members won't know."}
                    </p>
                    {MUTE_OPTIONS.map(([value, label]) => (
                        <button key={value} type="button" className="sheet-item" onClick={() => (onMute(row, value), close())}>
                            {label}
                        </button>
                    ))}
                    <button type="button" className="sheet-item sheet-back" onClick={() => setStep("main")}>
                        <ChevronLeft size={18} /> Back
                    </button>
                </div>
            )}
        </Modal>
    );
};
