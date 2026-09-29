import { useMemo, useState } from "react";
import { Building, FlaskConical, Landmark, MapPin, Plus, School, Theater, Trees, Users } from "lucide-react";
import { adminApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { ApiErrorAlert, AsyncContent, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Switch, Tabs } from "../../components/ui";
import { plural } from "../../lib/format";

// The kinds of venue, with the icon used for each. Labs belong to departments.
export const VENUE_TYPES = [
    { value: "AUDITORIUM", label: "Auditorium", icon: Theater },
    { value: "HALL", label: "Hall", icon: Landmark },
    { value: "CLASSROOM", label: "Classroom", icon: School },
    { value: "LAB", label: "Lab", icon: FlaskConical },
    { value: "OUTDOOR", label: "Outdoor", icon: Trees },
    { value: "OTHER", label: "Other", icon: Building }
];
const TYPE = Object.fromEntries(VENUE_TYPES.map((type) => [type.value, type]));

const blank = { name: "", location: "", capacity: "", status: "ACTIVE", type: "HALL", departmentCodes: [] };

const VenueEditor = ({ editing, departments, onClose, onSaved }) => {
    const toast = useToast();
    const creating = editing === "new";
    const [form, setForm] = useState(() =>
        creating ? blank : { name: editing.name, location: editing.location, capacity: String(editing.capacity), status: editing.status, type: editing.type || "HALL", departmentCodes: editing.departmentCodes || [] }
    );
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value?.target ? value.target.value : value }));
    const lab = form.type === "LAB";
    const toggleDepartment = (code) =>
        setForm((current) => ({ ...current, departmentCodes: current.departmentCodes.includes(code) ? current.departmentCodes.filter((item) => item !== code) : [...current.departmentCodes, code] }));
    const valid = form.name.trim().length >= 2 && form.location.trim().length >= 2 && Number(form.capacity) >= 1 && (!lab || form.departmentCodes.length > 0);

    const save = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        const body = { ...form, capacity: Number(form.capacity), departmentCodes: lab ? form.departmentCodes : [] };
        try {
            if (creating) {
                await adminApi.createVenue(body);
                toast.success(`${form.name} added`);
            } else {
                await adminApi.updateVenue(editing._id, body);
                toast.success(`${form.name} updated`);
            }
            onSaved();
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open
            onClose={pending ? undefined : onClose}
            size="lg"
            title={creating ? "Add a venue" : `Edit ${editing.name}`}
            description="Clubs book venues for events and interviews. Labs can only be booked for their own departments' events."
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form="venue-form" loading={pending} disabled={!valid}>
                        {creating ? "Add venue" : "Save"}
                    </Button>
                </>
            }
        >
            <form id="venue-form" className="stack" onSubmit={save}>
                <Field label="Kind of venue">
                    <div className="venue-type-picker" role="radiogroup" aria-label="Kind of venue">
                        {VENUE_TYPES.map((type) => {
                            const Icon = type.icon;
                            return (
                                <button key={type.value} type="button" role="radio" aria-checked={form.type === type.value} className={`venue-type ${form.type === type.value ? "is-on" : ""}`} onClick={() => set("type")(type.value)}>
                                    <Icon size={18} /> {type.label}
                                </button>
                            );
                        })}
                    </div>
                </Field>
                <div className="form-grid">
                    <Input label="Name" value={form.name} onChange={set("name")} placeholder={lab ? "e.g. CE Software Lab" : "e.g. Seminar Hall C"} maxLength={120} required />
                    <Input label="Capacity" type="number" min={1} value={form.capacity} onChange={set("capacity")} required />
                    <Input className="span-2" label="Location" value={form.location} onChange={set("location")} placeholder="Building and floor" maxLength={200} required />
                </div>
                {lab && (
                    <Field label="Belongs to" required hint="Only events for these departments' students can book this lab. An all-department club's event open to everyone may use any lab.">
                        <div className="venue-departments" role="group" aria-label="Departments">
                            {departments.map((department) => {
                                const on = form.departmentCodes.includes(department.code);
                                return (
                                    <button key={department.code} type="button" aria-pressed={on} className={`venue-department ${on ? "is-on" : ""}`} onClick={() => toggleDepartment(department.code)} title={department.name}>
                                        {department.code}
                                    </button>
                                );
                            })}
                        </div>
                    </Field>
                )}
                <Switch checked={form.status === "ACTIVE"} onChange={(on) => set("status")(on ? "ACTIVE" : "INACTIVE")} label="Bookable" description="Inactive venues can't be chosen for new events or interviews" />
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};

const VenueCard = ({ venue, index, onOpen }) => {
    const type = TYPE[venue.type] || TYPE.HALL;
    const Icon = type.icon;
    return (
        <button type="button" className={`venue-card is-${String(venue.type || "HALL").toLowerCase()} ${venue.status !== "ACTIVE" ? "is-inactive" : ""}`} style={{ "--i": Math.min(index, 12) }} onClick={() => onOpen(venue)}>
            <span className="venue-card-icon">
                <Icon size={20} />
            </span>
            <span className="venue-card-body">
                <strong>{venue.name}</strong>
                <span className="subtle small">
                    <MapPin size={12} /> {venue.location}
                </span>
            </span>
            <span className="venue-card-meta">
                <span className="venue-chip">{type.label}</span>
                <span className="venue-chip">
                    <Users size={12} /> {venue.capacity}
                </span>
                {venue.type === "LAB" && venue.departmentCodes?.map((code) => (
                    <span key={code} className="venue-chip is-dept">
                        {code}
                    </span>
                ))}
                {venue.status !== "ACTIVE" && <span className="venue-chip is-off">Not bookable</span>}
            </span>
        </button>
    );
};

/** Admin → Venues: every bookable space, by kind. Click a venue to edit it. */
const AdminVenuesPage = () => {
    const { reloadReference, reference } = useWorkspace();
    const { data, loading, error, reload } = useApi(() => referenceApi.venues(), []);
    const [editing, setEditing] = useState(null);
    const [filter, setFilter] = useState("ALL");

    const counts = useMemo(() => Object.fromEntries(VENUE_TYPES.map((type) => [type.value, (data || []).filter((venue) => (venue.type || "HALL") === type.value).length])), [data]);
    const shown = (data || []).filter((venue) => filter === "ALL" || (venue.type || "HALL") === filter);
    const tabs = [{ value: "ALL", label: "All", count: data?.length ?? null }, ...VENUE_TYPES.filter((type) => counts[type.value]).map((type) => ({ value: type.value, label: `${type.label}s`, count: counts[type.value] }))];

    return (
        <>
            <PageHeader
                eyebrow={
                    <>
                        <MapPin size={14} /> Administration
                    </>
                }
                title="Venues & labs"
                description={data ? `${plural(data.length, "venue")} · ${plural(counts.LAB || 0, "lab")} belonging to departments` : "Bookable spaces for events and interviews."}
                actions={
                    <Button onClick={() => setEditing("new")}>
                        <Plus size={16} /> Add venue
                    </Button>
                }
            />
            <div className="stack-lg">
                {data?.length > 0 && <Tabs tabs={tabs} value={filter} onChange={setFilter} />}
                <AsyncContent
                    loading={loading}
                    error={error}
                    onRetry={reload}
                    isEmpty={!shown.length}
                    empty={
                        <Card>
                            <EmptyState icon={MapPin} title="No venues here yet" description="Add the halls, rooms and labs clubs can book." />
                        </Card>
                    }
                >
                    <div className="venue-grid">
                        {shown.map((venue, index) => (
                            <VenueCard key={venue._id} venue={venue} index={index} onOpen={setEditing} />
                        ))}
                    </div>
                </AsyncContent>
            </div>
            {editing && (
                <VenueEditor
                    key={editing === "new" ? "new" : editing._id}
                    editing={editing}
                    departments={reference.departments || []}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        reload({ silent: true });
                        reloadReference();
                    }}
                />
            )}
        </>
    );
};

export default AdminVenuesPage;
