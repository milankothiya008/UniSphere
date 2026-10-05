import { useEffect, useId, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useDebounce } from "../../hooks/useDebounce";
import { batchLabel } from "../../lib/format";
import { Avatar, Spinner } from "../ui";

const detail = (user) => [user.departmentCode, user.batchCode && `Batch ${batchLabel(user.batchCode)}`].filter(Boolean).join(" · ");

/**
 * Search for eligible students to invite to a team (by name or email) and collect up to `max` of them.
 * `exclude` hides students already on the team.
 */
export const StudentPicker = ({ eventId, selected, onChange, max, exclude = [] }) => {
    const inputId = useId();
    const [search, setSearch] = useState("");
    const debounced = useDebounce(search.trim(), 300);
    const [results, setResults] = useState({ items: [], loading: false, error: null });
    const full = selected.length >= max;
    const hidden = new Set([...exclude.map(String), ...selected.map((user) => String(user._id))]);

    useEffect(() => {
        if (debounced.length < 2) {
            setResults({ items: [], loading: false, error: null });
            return undefined;
        }
        let active = true;
        setResults((prev) => ({ ...prev, loading: true, error: null }));
        eventApi
            .teamCandidates(eventId, debounced)
            .then((response) => active && setResults({ items: response.data, loading: false, error: null }))
            .catch((error) => active && setResults({ items: [], loading: false, error }));
        return () => {
            active = false;
        };
    }, [debounced, eventId]);

    const add = (user) => {
        if (!full) {
            onChange([...selected, user]);
            setSearch("");
        }
    };

    const shown = results.items.filter((user) => !hidden.has(String(user._id)));

    return (
        <div className="student-picker">
            <label className="field-label" htmlFor={inputId}>
                Invite teammates{" "}
                <span className="subtle">
                    ({selected.length}/{max})
                </span>
            </label>

            {selected.length > 0 && (
                <div className="picked-list">
                    {selected.map((user) => (
                        <span key={user._id} className="picked-chip">
                            <Avatar name={user.name} src={user.avatar} size="sm" />
                            <span>{user.name}</span>
                            <button type="button" onClick={() => onChange(selected.filter((item) => item._id !== user._id))} aria-label={`Remove ${user.name}`}>
                                <X size={13} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className={`picker-search ${full ? "is-disabled" : ""}`}>
                <Search size={16} />
                <input
                    id={inputId}
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={full ? "Your team is full" : "Search students by name or email"}
                    disabled={full}
                    autoComplete="off"
                />
                {results.loading && <Spinner />}
            </div>

            {debounced.length >= 2 && !full && (
                <div className="picker-results" role="listbox" aria-label="Students">
                    {shown.map((user) => (
                        <button
                            key={user._id}
                            type="button"
                            role="option"
                            aria-selected="false"
                            className="picker-option"
                            disabled={!user.available}
                            onClick={() => add(user)}
                        >
                            <Avatar name={user.name} src={user.avatar} size="sm" />
                            <span className="grow">
                                <strong>{user.name}</strong>
                                <small>
                                    {user.available ? `${user.email} · ${detail(user)}` : "Already registered for this event"}
                                    {user.available && user.busyWith ? ` · Busy then: ${user.busyWith}` : ""}
                                </small>
                            </span>
                            {user.available && <UserPlus size={16} />}
                        </button>
                    ))}
                    {!results.loading && !results.error && shown.length === 0 && <p className="picker-empty">No eligible students match "{debounced}".</p>}
                    {results.error && <p className="picker-empty">{results.error.message}</p>}
                </div>
            )}
            <span className="field-hint">Only students eligible for this event can be invited. They join by accepting your invite.</span>
        </div>
    );
};
