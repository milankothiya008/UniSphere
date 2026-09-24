import { useState } from "react";
import { Pencil, Plus, Settings2 } from "lucide-react";
import { adminApi, referenceApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { ApiErrorAlert, AsyncContent, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader } from "../../components/ui";

// Shared editor for departments (code + name) and academic batches (code + label).
const ReferenceEditor = ({ title, description, kind, load, create, update, labelField, codeHint, codePattern }) => {
    const toast = useToast();
    const { reloadReference } = useWorkspace();
    const { data, loading, error, reload } = useApi(load, []);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({});
    const [pending, setPending] = useState(false);
    const [formError, setFormError] = useState(null);

    const open = (item) => {
        setEditing(item || "new");
        setForm(item ? { code: item.code, [labelField]: item[labelField], isActive: item.isActive } : { code: "", [labelField]: "", isActive: true });
        setFormError(null);
    };

    const save = async (event) => {
        event.preventDefault();
        setPending(true);
        setFormError(null);
        try {
            if (editing === "new") {
                await create({ ...form, code: form.code.trim().toUpperCase() });
                toast.success(`${kind} added`);
            } else {
                await update(editing._id, { [labelField]: form[labelField], isActive: form.isActive });
                toast.success(`${kind} updated`);
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

    const valid = codePattern.test(form.code || "") && (form[labelField] || "").trim().length >= 2;

    return (
        <Card
            title={title}
            actions={
                <Button size="sm" onClick={() => open(null)}>
                    <Plus size={14} /> Add
                </Button>
            }
            padded={false}
        >
            <p className="subtle" style={{ padding: "12px 20px 0" }}>
                {description}
            </p>
            <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState title={`No ${kind.toLowerCase()}s yet`} />}>
                <div className="list-rows">
                    {data?.map((item) => (
                        <div key={item._id} className="list-row">
                            <Badge tone="ink">{item.code}</Badge>
                            <span className="grow title">{item[labelField]}</span>
                            {!item.isActive && <Badge>Inactive</Badge>}
                            <Button size="sm" variant="ghost" onClick={() => open(item)} aria-label={`Edit ${item[labelField]}`}>
                                <Pencil size={14} />
                            </Button>
                        </div>
                    ))}
                </div>
            </AsyncContent>
            <Modal
                open={Boolean(editing)}
                onClose={() => setEditing(null)}
                title={editing === "new" ? `Add ${kind.toLowerCase()}` : `Edit ${kind.toLowerCase()}`}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setEditing(null)}>
                            Cancel
                        </Button>
                        <Button type="submit" form={`${kind}-form`} loading={pending} disabled={!valid}>
                            Save
                        </Button>
                    </>
                }
            >
                <form id={`${kind}-form`} className="stack" onSubmit={save}>
                    <Input label="Code" value={form.code || ""} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} disabled={editing !== "new"} hint={codeHint} required />
                    <Input label={labelField === "name" ? "Name" : "Label"} value={form[labelField] || ""} onChange={(e) => setForm((f) => ({ ...f, [labelField]: e.target.value }))} required />
                    <Checkbox label="Active (accepted for new registrations)" checked={Boolean(form.isActive)} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                    <ApiErrorAlert error={formError} />
                </form>
            </Modal>
        </Card>
    );
};

const AdminAcademicsPage = () => (
    <>
        <PageHeader
            eyebrow={<><Settings2 size={14} /> Administration</>}
            title="Departments & batches"
            description="These decide which university emails can register: students need an active batch and department, faculty an active department."
        />
        <div className="grid-2" style={{ alignItems: "start" }}>
            <ReferenceEditor
                title="Departments"
                kind="Department"
                description="Department codes appear in emails, e.g. 24CE1234 or name.ce."
                load={() => referenceApi.departments()}
                create={adminApi.createDepartment}
                update={adminApi.updateDepartment}
                labelField="name"
                codeHint="2–4 letters, e.g. CE"
                codePattern={/^[A-Za-z]{2,4}$/}
            />
            <ReferenceEditor
                title="Academic batches"
                kind="Batch"
                description="Batch codes are the admission year's last two digits, e.g. 24 for 2024."
                load={() => referenceApi.batches()}
                create={adminApi.createBatch}
                update={adminApi.updateBatch}
                labelField="label"
                codeHint="Two digits, e.g. 24"
                codePattern={/^\d{2}$/}
            />
        </div>
    </>
);

export default AdminAcademicsPage;
