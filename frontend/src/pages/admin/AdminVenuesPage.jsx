import { useState } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { adminApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { ApiErrorAlert, AsyncContent, Button, Card, EmptyState, Input, Modal, PageHeader, Select, StatusBadge } from "../../components/ui";

const blank = { name: "", location: "", capacity: "", status: "ACTIVE" };

const AdminVenuesPage = () => {
    const toast = useToast();
    const { reloadReference } = useWorkspace();
    const { data, loading, error, reload } = useApi(() => referenceApi.venues(), []);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(blank);
    const [pending, setPending] = useState(false);
    const [formError, setFormError] = useState(null);

    const open = (venue) => {
        setEditing(venue || "new");
        setForm(venue ? { name: venue.name, location: venue.location, capacity: String(venue.capacity), status: venue.status } : blank);
        setFormError(null);
    };

    const save = async (event) => {
        event.preventDefault();
        setPending(true);
        setFormError(null);
        const body = { ...form, capacity: Number(form.capacity) };
        try {
            if (editing === "new") {
                await adminApi.createVenue(body);
                toast.success("Venue added");
            } else {
                await adminApi.updateVenue(editing._id, body);
                toast.success("Venue updated");
            }
            setEditing(null);
            reload({ silent: true });
            reloadReference();
        } catch (err) {
            setFormError(err);
        } finally {
            setPending(false);
        }
    };

    const valid = form.name.trim().length >= 2 && form.location.trim().length >= 2 && Number(form.capacity) >= 1;

    return (
        <>
            <PageHeader
                eyebrow={<><MapPin size={14} /> Administration</>}
                title="Venues"
                description="Bookable spaces for club events. Approved and published events reserve their venue slot."
                actions={
                    <Button onClick={() => open(null)}>
                        <Plus size={16} /> Add venue
                    </Button>
                }
            />
            <Card padded={false}>
                <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={MapPin} title="No venues yet" description="Add the halls and rooms clubs can book." />}>
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Venue</th>
                                    <th>Location</th>
                                    <th>Capacity</th>
                                    <th>Status</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {data?.map((venue) => (
                                    <tr key={venue._id}>
                                        <td>
                                            <strong>{venue.name}</strong>
                                        </td>
                                        <td>{venue.location}</td>
                                        <td>{venue.capacity}</td>
                                        <td>
                                            <StatusBadge status={venue.status} />
                                        </td>
                                        <td className="actions">
                                            <Button size="sm" variant="ghost" onClick={() => open(venue)}>
                                                <Pencil size={14} /> Edit
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </AsyncContent>
            </Card>
            <Modal
                open={Boolean(editing)}
                onClose={() => setEditing(null)}
                title={editing === "new" ? "Add venue" : "Edit venue"}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setEditing(null)}>
                            Cancel
                        </Button>
                        <Button type="submit" form="venue-form" loading={pending} disabled={!valid}>
                            Save
                        </Button>
                    </>
                }
            >
                <form id="venue-form" className="stack" onSubmit={save}>
                    <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                    <Input label="Location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} required />
                    <div className="form-grid">
                        <Input label="Capacity" type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} required />
                        <Select
                            label="Status"
                            value={form.status}
                            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                            options={[
                                { value: "ACTIVE", label: "Active" },
                                { value: "INACTIVE", label: "Inactive" }
                            ]}
                        />
                    </div>
                    <ApiErrorAlert error={formError} />
                </form>
            </Modal>
        </>
    );
};

export default AdminVenuesPage;
