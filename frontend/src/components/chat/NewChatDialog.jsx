import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Users, X } from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { Avatar, Button, Input, Modal, SearchInput, Spinner } from "../ui";
import { batchLabel } from "../../lib/format";

const subtitle = (person) =>
    person.accountType === "FACULTY"
        ? `Faculty${person.departmentCode ? ` · ${person.departmentCode}` : ""}`
        : [person.departmentCode, person.batchCode && `Batch ${batchLabel(person.batchCode)}`].filter(Boolean).join(" · ");

/** Search students and faculty (suggestions first: people you've chatted with and your club-mates). */
export const PeoplePicker = ({ selected = [], onToggle, multiple = false, exclude = [] }) => {
    const [q, setQ] = useState("");
    const [state, setState] = useState({ items: [], loading: true });

    useEffect(() => {
        let alive = true;
        setState((current) => ({ ...current, loading: true }));
        const timer = setTimeout(() => {
            chatApi
                .people(q.trim())
                .then((response) => alive && setState({ items: response.data, loading: false }))
                .catch(() => alive && setState({ items: [], loading: false }));
        }, 200);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [q]);

    const items = state.items.filter((person) => !exclude.includes(String(person._id)));
    const chosen = new Set(selected.map((person) => String(person._id)));
    return (
        <div className="people-picker">
            <SearchInput value={q} onChange={setQ} placeholder="Search students and faculty" />
            {multiple && selected.length > 0 && (
                <div className="people-chosen">
                    {selected.map((person) => (
                        <button key={person._id} type="button" className="people-chip" onClick={() => onToggle(person)} aria-label={`Remove ${person.name}`}>
                            <Avatar name={person.name} src={person.avatar} size="sm" /> {person.name.split(" ")[0]} <X size={13} />
                        </button>
                    ))}
                </div>
            )}
            <span className="people-heading">{q.trim() ? "Results" : "Suggested"}</span>
            <ul className="people-list" role="listbox" aria-multiselectable={multiple}>
                {state.loading && !items.length ? (
                    <li className="people-empty">
                        <Spinner />
                    </li>
                ) : items.length ? (
                    items.map((person) => {
                        const on = chosen.has(String(person._id));
                        return (
                            <li key={person._id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={on}
                                    className={`people-row ${on ? "is-on" : ""}`}
                                    onClick={() => onToggle(person)}
                                >
                                    <Avatar name={person.name} src={person.avatar} />
                                    <span>
                                        <strong>{person.name}</strong>
                                        <span className="subtle small">{subtitle(person)}</span>
                                    </span>
                                    {multiple && <span className={`people-check ${on ? "is-on" : ""}`}>{on && <Check size={14} strokeWidth={3} />}</span>}
                                </button>
                            </li>
                        );
                    })
                ) : (
                    <li className="people-empty subtle small">{q.trim() ? "No one found" : "Search by name or university email"}</li>
                )}
            </ul>
        </div>
    );
};

/** "New message": pick one person to chat, or switch to creating a group. */
export const NewChatDialog = ({ open, onClose }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [mode, setMode] = useState("direct");
    const [members, setMembers] = useState([]);
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (open) {
            setMode("direct");
            setMembers([]);
            setName("");
        }
    }, [open]);

    const startDirect = async (person) => {
        setPending(true);
        try {
            const response = await chatApi.openDirect(person._id);
            onClose();
            navigate(`/messages/${response.data._id}`);
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    const createGroup = async () => {
        setPending(true);
        try {
            const response = await chatApi.createGroup({ name: name.trim(), members: members.map((person) => person._id) });
            onClose();
            navigate(`/messages/${response.data._id}`);
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    const toggle = (person) =>
        setMembers((current) => (current.some((item) => item._id === person._id) ? current.filter((item) => item._id !== person._id) : [...current, person]));

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title={mode === "direct" ? "New message" : "New group"}
            footer={
                mode === "group" ? (
                    <>
                        <Button variant="secondary" onClick={() => setMode("direct")} disabled={pending}>
                            <ChevronLeft size={16} /> Back
                        </Button>
                        <Button onClick={createGroup} loading={pending} disabled={!name.trim() || !members.length}>
                            Create group{members.length ? ` (${members.length + 1})` : ""}
                        </Button>
                    </>
                ) : null
            }
        >
            {mode === "direct" ? (
                <div className="stack">
                    <button type="button" className="people-row new-group-row" onClick={() => setMode("group")}>
                        <span className="new-group-icon">
                            <Users size={20} />
                        </span>
                        <span>
                            <strong>Create a group</strong>
                            <span className="subtle small">A project team, study group or friends</span>
                        </span>
                    </button>
                    <PeoplePicker onToggle={startDirect} />
                </div>
            ) : (
                <div className="stack">
                    <Input
                        label="Group name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={80}
                        placeholder="e.g. Hackathon squad"
                        required
                    />
                    <PeoplePicker multiple selected={members} onToggle={toggle} />
                </div>
            )}
        </Modal>
    );
};
