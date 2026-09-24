import { useEffect, useId, useState } from "react";
import { Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, Input, Modal } from "../ui";
import { StudentPicker } from "./StudentPicker";

// Registering a team: the student becomes the leader, names the team and invites teammates (who accept later).
export const TeamRegisterDialog = ({ open, onClose, event, onRegistered }) => {
    const toast = useToast();
    const formId = useId();
    const [name, setName] = useState("");
    const [invitees, setInvitees] = useState([]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setName("");
            setInvitees([]);
            setError(null);
        }
    }, [open]);

    const full = event.registrationState === "FULL";
    const tooShort = name.trim().length < 2;

    const submit = async (submitEvent) => {
        submitEvent.preventDefault();
        if (tooShort) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            const response = await eventApi.register(event._id, { teamName: name.trim(), invitees: invitees.map((user) => user._id) });
            if (response.data?.waitlisted) {
                toast.info(response.message);
            } else {
                toast.success(response.message);
            }
            onRegistered?.(response.data);
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
            title={full ? "Join the waitlist as a team" : "Register your team"}
            description={`Teams of ${event.minTeamSize}–${event.maxTeamSize}. You'll be the team leader; teammates join by accepting your invite.`}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form={formId} loading={pending} disabled={tooShort}>
                        <Users size={16} /> {full ? "Join waitlist" : "Register team"}
                        {invitees.length ? ` & invite ${invitees.length}` : ""}
                    </Button>
                </>
            }
        >
            <form id={formId} className="stack" onSubmit={submit}>
                <Input label="Team name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Byte Busters" hint="Must be unique for this event" required />
                <StudentPicker eventId={event._id} selected={invitees} onChange={setInvitees} max={event.maxTeamSize - 1} />
                {event.minTeamSize > 1 && (
                    <p className="subtle small" style={{ margin: 0 }}>
                        Your team needs at least {event.minTeamSize} members (including you) to be complete. You can invite more people later, until registration closes.
                    </p>
                )}
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};
