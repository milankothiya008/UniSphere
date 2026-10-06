import { useEffect, useState } from "react";
import { Mail, Users, X } from "lucide-react";
import { clubApi, feedApi } from "../../api/endpoints";
import { useOptionalWorkspace } from "../../context/WorkspaceContext";
import { useDebounce } from "../../hooks/useDebounce";
import { batchLabel } from "../../lib/format";
import { Checkbox, Field, Segmented, UserPicker } from "../ui";

// Who an announcement goes to. Only the chosen people are notified (and emailed), so nobody gets
// notifications that aren't for them.
export const AUDIENCE_MODES = [
    { value: "FOLLOWERS", label: "Followers", hint: "Everyone who follows the club (bell on), members included." },
    { value: "MEMBERS", label: "Members", hint: "The club's members and its faculty mentor." },
    { value: "CUSTOM", label: "Choose…", hint: "Only the roles, departments or people you pick." },
    { value: "EVERYONE", label: "Everyone", hint: "The whole campus in-app — use it for news everyone needs." }
];

export const emptyAudience = () => ({ mode: "FOLLOWERS", roles: [], departments: [], batches: [], users: [], includeMentor: false });

/** What the API expects (people as ids). */
export const audiencePayload = (audience) =>
    audience.mode === "CUSTOM"
        ? {
              mode: "CUSTOM",
              roles: audience.roles,
              departments: audience.departments,
              batches: audience.batches,
              users: audience.users.map((user) => user._id),
              includeMentor: audience.includeMentor
          }
        : { mode: audience.mode };

export const audienceIsEmpty = (audience) =>
    audience.mode === "CUSTOM" &&
    !audience.roles.length &&
    !audience.departments.length &&
    !audience.batches.length &&
    !audience.users.length &&
    !audience.includeMentor;

const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

export const AudiencePicker = ({ clubId, value, onChange }) => {
    const workspace = useOptionalWorkspace();
    const reference = workspace?.reference || { departments: [], batches: [] };
    const [roles, setRoles] = useState([]);
    const [reach, setReach] = useState(null);
    const set = (patch) => onChange({ ...value, ...patch });
    const debounced = useDebounce(JSON.stringify([clubId, audiencePayload(value)]), 350);

    useEffect(() => {
        if (!clubId) return undefined;
        let active = true;
        clubApi
            .roles(clubId)
            .then((response) => active && setRoles(response.data.roles || []))
            .catch(() => active && setRoles([]));
        return () => {
            active = false;
        };
    }, [clubId]);

    // How many people it reaches, before sending.
    useEffect(() => {
        const [club, audience] = JSON.parse(debounced);
        if (!club || audienceIsEmpty({ ...value, ...audience, users: audience.users || [] })) {
            setReach(null);
            return undefined;
        }
        let active = true;
        feedApi
            .audiencePreview({ club, audience })
            .then((response) => active && setReach(response.data))
            .catch(() => active && setReach(null));
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced]);

    const mode = AUDIENCE_MODES.find((item) => item.value === value.mode);

    return (
        <div className="audience-picker stack-sm">
            <Field label="Send to">
                <Segmented label="Send to" options={AUDIENCE_MODES} value={value.mode} onChange={(next) => set({ mode: next })} />
            </Field>
            <span className="subtle small">{mode?.hint}</span>

            {value.mode === "CUSTOM" && (
                <div className="audience-custom stack">
                    {roles.length > 0 && (
                        <Field label="Club roles" hint="Everyone in the club who holds one of these roles">
                            <div className="row">
                                {roles.map((role) => (
                                    <Checkbox
                                        key={role.key}
                                        label={role.name}
                                        checked={value.roles.includes(role.key)}
                                        onChange={() => set({ roles: toggle(value.roles, role.key) })}
                                    />
                                ))}
                                <Checkbox label="Faculty mentor" checked={value.includeMentor} onChange={() => set({ includeMentor: !value.includeMentor })} />
                            </div>
                        </Field>
                    )}
                    {reference.departments.length > 0 && (
                        <Field label="Students of these departments" hint="Any student of the department, member or not">
                            <div className="row">
                                {reference.departments.map((department) => (
                                    <Checkbox
                                        key={department._id}
                                        label={department.code}
                                        checked={value.departments.includes(department.code)}
                                        onChange={() => set({ departments: toggle(value.departments, department.code) })}
                                    />
                                ))}
                            </div>
                        </Field>
                    )}
                    {reference.batches.length > 0 && (
                        <Field label="Batches" hint="Alone: every student of these batches. With departments: only those batches of them.">
                            <div className="row">
                                {reference.batches.map((batch) => (
                                    <Checkbox
                                        key={batch._id}
                                        label={batchLabel(batch.code)}
                                        checked={value.batches.includes(batch.code)}
                                        onChange={() => set({ batches: toggle(value.batches, batch.code) })}
                                    />
                                ))}
                            </div>
                        </Field>
                    )}
                    <UserPicker
                        label="Specific people"
                        placeholder="Search students or faculty"
                        exclude={value.users.map((user) => user._id)}
                        onSelect={(user) => set({ users: [...value.users, user] })}
                    />
                    {value.users.length > 0 && (
                        <div className="chip-list">
                            {value.users.map((user) => (
                                <span key={user._id} className="chip">
                                    {user.name}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${user.name}`}
                                        onClick={() => set({ users: value.users.filter((item) => item._id !== user._id) })}
                                    >
                                        <X size={13} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {reach && (
                <div className="audience-reach small" aria-live="polite">
                    <Users size={14} /> Reaches {reach.count} {reach.count === 1 ? "person" : "people"}
                    {reach.email > 0 && (
                        <>
                            {" "}
                            · <Mail size={14} /> {reach.email} by email
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
