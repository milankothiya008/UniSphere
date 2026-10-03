import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { Avatar, Button, Modal, SearchInput, Spinner } from "../ui";

const MAX = 5;

/** Forward a message to up to five chats (WhatsApp's limit). */
export const ForwardDialog = ({ message, onClose }) => {
    const toast = useToast();
    const [rows, setRows] = useState(null);
    const [chosen, setChosen] = useState([]);
    const [q, setQ] = useState("");
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (!message) return;
        setChosen([]);
        setQ("");
        setRows(null);
        chatApi
            .conversations()
            .then((response) => setRows(response.data))
            .catch(() => setRows([]));
    }, [message]);

    const toggle = (id) =>
        setChosen((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.length < MAX ? [...current, id] : current));
    const visible = (rows || []).filter((row) => !q.trim() || row.title.toLowerCase().includes(q.trim().toLowerCase()));

    const send = async () => {
        setPending(true);
        try {
            await chatApi.forward(message._id, chosen);
            toast.success(`Forwarded to ${chosen.length} ${chosen.length === 1 ? "chat" : "chats"}`);
            onClose();
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open={Boolean(message)}
            onClose={pending ? undefined : onClose}
            title="Forward to…"
            description={`Choose up to ${MAX} chats.`}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button onClick={send} loading={pending} disabled={!chosen.length}>
                        Send{chosen.length ? ` (${chosen.length})` : ""}
                    </Button>
                </>
            }
        >
            <div className="stack">
                <SearchInput value={q} onChange={setQ} placeholder="Search chats" />
                {!rows ? (
                    <Spinner />
                ) : (
                    <ul className="people-list">
                        {visible.map((row) => {
                            const on = chosen.includes(row._id);
                            return (
                                <li key={row._id}>
                                    <button
                                        type="button"
                                        className={`people-row ${on ? "is-on" : ""}`}
                                        onClick={() => toggle(row._id)}
                                        aria-pressed={on}
                                        disabled={!on && chosen.length >= MAX}
                                    >
                                        <Avatar name={row.title} src={row.avatar} square={row.type === "CLUB"} />
                                        <span>
                                            <strong>{row.title}</strong>
                                            <span className="subtle small">
                                                {row.type === "DIRECT" ? "Chat" : row.type === "CLUB" ? "Club group" : "Group"}
                                            </span>
                                        </span>
                                        <span className={`people-check ${on ? "is-on" : ""}`}>{on && <Check size={14} strokeWidth={3} />}</span>
                                    </button>
                                </li>
                            );
                        })}
                        {!visible.length && <li className="people-empty subtle small">No chats</li>}
                    </ul>
                )}
            </div>
        </Modal>
    );
};
