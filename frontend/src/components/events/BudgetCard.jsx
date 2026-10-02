import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Plus, ReceiptIndianRupee, Trash2, Wallet } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Badge, Button, Card, Input, Modal, Textarea } from "../ui";
import { timeAgo } from "../../lib/format";

export const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

const blankLine = () => ({ item: "", amount: "", note: "" });

/** After the event: what was actually spent, line by line. The mentor is notified. */
const ExpensesDialog = ({ open, onClose, event, onSaved }) => {
    const toast = useToast();
    const formId = useId();
    const [lines, setLines] = useState([]);
    const [note, setNote] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!open) return;
        const recorded = event.expenses?.items || [];
        // Start from the approved budget so the club only fills in amounts.
        setLines(
            recorded.length
                ? recorded.map((row) => ({ item: row.item, amount: String(row.amount), note: row.note || "" }))
                : event.budgetItems?.length
                  ? event.budgetItems.map((row) => ({ item: row.item, amount: "", note: "" }))
                  : [blankLine()]
        );
        setNote(event.expenses?.note || "");
        setError(null);
    }, [open, event]);

    const setLine = (index, patch) => setLines((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    const total = lines.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const filled = lines.filter((row) => row.item.trim() || row.amount !== "");
    const incomplete = filled.some((row) => !row.item.trim() || row.amount === "" || Number(row.amount) < 0);

    const submit = async (submitEvent) => {
        submitEvent.preventDefault();
        setPending(true);
        setError(null);
        try {
            const response = await eventApi.recordExpenses(event._id, {
                items: filled.map((row) => ({ item: row.item.trim(), amount: Number(row.amount), note: row.note.trim() })),
                note: note.trim()
            });
            toast.success("Spending saved — your mentor was notified");
            onSaved?.(response.data);
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            size="lg"
            title="Record spending"
            description={`What ${event.title} actually cost. Approved budget: ${money(event.budgetTotal)}.`}
            footer={
                <>
                    <span className="budget-total" style={{ marginRight: "auto" }}>
                        {money(total)}
                    </span>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form={formId} loading={pending} disabled={incomplete}>
                        Save spending
                    </Button>
                </>
            }
        >
            <form id={formId} className="stack" onSubmit={submit}>
                {lines.map((row, index) => (
                    <div key={index} className="equipment-row">
                        <Input
                            label="Spent on"
                            value={row.item}
                            onChange={(e) => setLine(index, { item: e.target.value })}
                            maxLength={120}
                            placeholder="e.g. Snacks"
                        />
                        <Input label="Amount (₹)" type="number" min={0} value={row.amount} onChange={(e) => setLine(index, { amount: e.target.value })} />
                        <Input
                            label="Note"
                            value={row.note}
                            onChange={(e) => setLine(index, { note: e.target.value })}
                            maxLength={200}
                            placeholder="Bill no., vendor…"
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                            aria-label={`Remove line ${index + 1}`}
                        >
                            <Trash2 size={15} />
                        </Button>
                    </div>
                ))}
                <div className="row">
                    <Button variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])} disabled={lines.length >= 60}>
                        <Plus size={14} /> Add line
                    </Button>
                </div>
                <Textarea
                    label="Note for your mentor (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder="Anything over budget, sponsorships, refunds…"
                />
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};

/**
 * Budget and equipment the club asked for (approved by the mentor with the event), then the actual spending
 * once the event has started. Only the club's organisers, the mentor and the admin receive these fields.
 */
export const BudgetCard = ({ event, onChange }) => {
    const [recording, setRecording] = useState(false);
    if (!Array.isArray(event.budgetItems)) return null;
    const budget = event.budgetItems;
    const equipment = event.equipment || [];
    const spent = event.expenses?.items || [];
    const started = new Date(event.startAt) <= new Date();
    const canRecord = event.viewer?.canManage && started && ["PUBLISHED", "COMPLETED"].includes(event.status);
    if (!budget.length && !equipment.length && !spent.length && !canRecord) return null;
    const over = spent.length > 0 && event.expensesTotal > event.budgetTotal;

    return (
        <Card
            title={
                <h2 className="row">
                    <Wallet size={18} /> Budget &amp; equipment
                </h2>
            }
            actions={budget.length > 0 && <span className="budget-total">{money(event.budgetTotal)}</span>}
        >
            <div className="stack">
                {budget.length > 0 ? (
                    <table className="budget-table">
                        <tbody>
                            {budget.map((row, index) => (
                                <tr key={index}>
                                    <td>
                                        {row.item}
                                        {row.note && <span className="subtle small"> · {row.note}</span>}
                                    </td>
                                    <td className="subtle nowrap">
                                        {row.quantity} × {money(row.unitCost)}
                                    </td>
                                    <td className="num">{money(row.quantity * row.unitCost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <span className="subtle small">No budget requested.</span>
                )}
                {event.budgetNote && (
                    <p className="subtle small" style={{ margin: 0 }}>
                        {event.budgetNote}
                    </p>
                )}

                {equipment.length > 0 && (
                    <div className="stack-sm">
                        <strong className="row" style={{ gap: 6 }}>
                            <Package size={15} /> Equipment
                        </strong>
                        <ul className="equipment-list">
                            {equipment.map((row, index) => (
                                <li key={index}>
                                    <span>
                                        {row.name}
                                        {row.note && <span className="subtle small"> · {row.note}</span>}
                                    </span>
                                    <Badge>× {row.quantity}</Badge>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {spent.length > 0 && (
                    <div className="stack-sm budget-spent">
                        <div className="row" style={{ justifyContent: "space-between" }}>
                            <strong className="row" style={{ gap: 6 }}>
                                <ReceiptIndianRupee size={15} /> Actual spending
                            </strong>
                            <Badge tone={over ? "danger" : "success"}>
                                {money(event.expensesTotal)}{" "}
                                {over
                                    ? `· ${money(event.expensesTotal - event.budgetTotal)} over`
                                    : budget.length
                                      ? `· ${money(event.budgetTotal - event.expensesTotal)} under`
                                      : ""}
                            </Badge>
                        </div>
                        <table className="budget-table">
                            <tbody>
                                {spent.map((row, index) => (
                                    <tr key={index}>
                                        <td>
                                            {row.item}
                                            {row.note && <span className="subtle small"> · {row.note}</span>}
                                        </td>
                                        <td className="num">{money(row.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {event.expenses.note && (
                            <p className="subtle small" style={{ margin: 0 }}>
                                {event.expenses.note}
                            </p>
                        )}
                        <span className="subtle small">Recorded {timeAgo(event.expenses.submittedAt)}</span>
                    </div>
                )}

                {canRecord && (
                    <Button variant="secondary" block onClick={() => setRecording(true)}>
                        <ReceiptIndianRupee size={16} /> {spent.length ? "Update spending" : "Record spending"}
                    </Button>
                )}
                {event.viewer?.canManage && !started && (
                    <span className="subtle small">
                        Need a change? <Link to={`/events/${event._id}/edit`}>Edit the event</Link> — your mentor reviews budget changes.
                    </span>
                )}
            </div>
            {canRecord && <ExpensesDialog open={recording} onClose={() => setRecording(false)} event={event} onSaved={onChange} />}
        </Card>
    );
};
