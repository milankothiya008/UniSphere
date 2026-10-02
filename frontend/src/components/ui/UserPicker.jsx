import { useEffect, useId, useRef, useState } from "react";
import { userApi } from "../../api/endpoints";
import { useDebounce } from "../../hooks/useDebounce";
import { Field, SearchInput } from "./Form";
import { Avatar } from "./Misc";
import { batchLabel } from "../../lib/format";

/**
 * Searches verified CampusConnect users. `accountType` restricts results (STUDENT / FACULTY).
 * `departments` (list of codes) restricts results to those departments.
 * `exclude` hides already-selected ids. Calls onSelect(user) when an option is chosen.
 */
export const UserPicker = ({ label, hint, error, accountType, departments, onSelect, exclude = [], placeholder = "Search by name or email", source }) => {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const debounced = useDebounce(query, 250);
    const boxRef = useRef(null);
    const listId = useId();
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const departmentKey = departments?.length ? departments.join(",") : undefined;

    useEffect(() => {
        let active = true;
        const term = debounced.trim();

        if (term.length < 2) {
            setResults([]);
            return undefined;
        }

        setLoading(true);
        const load = sourceRef.current ? Promise.resolve(sourceRef.current(term)) : userApi.search(term, accountType, departmentKey).then((response) => response.data);
        load.then((users) => active && setResults(users || []))
            .catch(() => active && setResults([]))
            .finally(() => active && setLoading(false));

        return () => {
            active = false;
        };
    }, [debounced, accountType, departmentKey]);

    useEffect(() => {
        const close = (event) => !boxRef.current?.contains(event.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const visible = results.filter((user) => !exclude.includes(user._id));

    return (
        <Field label={label} hint={hint} error={error}>
            <div className="picker" ref={boxRef}>
                <SearchInput
                    value={query}
                    onChange={(value) => {
                        setQuery(value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    placeholder={placeholder}
                    aria-controls={listId}
                    autoComplete="off"
                />
                {open && query.trim().length >= 2 && (
                    <div className="picker-results" id={listId} role="listbox">
                        {loading && <div className="subtle" style={{ padding: 10 }}>Searching…</div>}
                        {!loading && visible.length === 0 && <div className="subtle" style={{ padding: 10 }}>No matching users</div>}
                        {!loading &&
                            visible.map((user) => (
                                <button
                                    key={user._id}
                                    type="button"
                                    role="option"
                                    aria-selected="false"
                                    className="picker-option"
                                    onClick={() => {
                                        onSelect(user);
                                        setQuery("");
                                        setOpen(false);
                                    }}
                                >
                                    <Avatar name={user.name} src={user.avatar} size="sm" />
                                    <span style={{ minWidth: 0 }}>
                                        <strong style={{ display: "block", fontSize: "0.9rem" }}>{user.name}</strong>
                                        <span className="subtle">
                                            {user.email}
                                            {user.departmentCode ? ` · ${user.departmentCode}` : ""}
                                            {user.batchCode ? ` · ${batchLabel(user.batchCode)}` : ""}
                                        </span>
                                    </span>
                                </button>
                            ))}
                    </div>
                )}
            </div>
        </Field>
    );
};
