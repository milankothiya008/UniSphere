import { useEffect, useId, useState } from "react";
import { Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, Input, Modal } from "../ui";
import { StudentPicker } from "./StudentPicker";
import { QuestionFields, missingAnswer, toAnswers } from "../forms/QuestionFields";
import { formQuestions } from "../events/RegistrationFormDialog";
import { switchedText, useClashSwitch } from "../events/ScheduleClash";

// Registering a team: the student becomes the leader, names the team and invites teammates (who accept later).
export const TeamRegisterDialog = ({ open, onClose, event, onRegistered, replace = [] }) => {
    const { attempt, dialog: clashDialog } = useClashSwitch({ eventTitle: event.title, full: event.registrationState === "FULL" });
    const toast = useToast();
    const formId = useId();
    const [name, setName] = useState("");
    const [invitees, setInvitees] = useState([]);
    const [teamValues, setTeamValues] = useState({});
    const [values, setValues] = useState({});
    const { member, team } = formQuestions(event, "LEADER");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setName("");
            setInvitees([]);
            setTeamValues({});
            setValues({});
            setError(null);
        }
    }, [open]);

    const full = event.registrationState === "FULL";
    const missing = missingAnswer(team, teamValues) || missingAnswer(member, values);
    const tooShort = name.trim().length < 2 || Boolean(missing);

    const submit = async (submitEvent) => {
        submitEvent.preventDefault();
        if (tooShort) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            const answers = team.length || member.length ? { teamAnswers: toAnswers(team, teamValues), answers: toAnswers(member, values) } : {};
            const response = await attempt((extra) =>
                eventApi.register(event._id, {
                    teamName: name.trim(),
                    invitees: invitees.map((user) => user._id),
                    ...answers,
                    ...(replace.length ? { replace } : {}),
                    ...extra
                })
            );
            if (!response) return;
            if (response.data?.waitlisted) {
                toast.info(response.message);
            } else {
                toast.success(`${response.message}${switchedText(response)}`);
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
                <Input
                    label="Team name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder="e.g. Byte Busters"
                    hint="Must be unique for this event"
                    required
                />
                <StudentPicker eventId={event._id} selected={invitees} onChange={setInvitees} max={event.maxTeamSize - 1} />
                {team.length > 0 && (
                    <section className="form-group">
                        <h3 className="form-group-title">About your team</h3>
                        <QuestionFields questions={team} values={teamValues} onChange={setTeamValues} idPrefix="team" />
                    </section>
                )}
                {member.length > 0 && (
                    <section className="form-group">
                        <h3 className="form-group-title">About you</h3>
                        <p className="subtle small" style={{ margin: 0 }}>
                            Teammates answer these too when they accept your invite.
                        </p>
                        <QuestionFields questions={member} values={values} onChange={setValues} idPrefix="me" />
                    </section>
                )}
                {event.minTeamSize > 1 && (
                    <p className="subtle small" style={{ margin: 0 }}>
                        Your team needs at least {event.minTeamSize} members (including you) to be complete. You can invite more people later, until
                        registration closes.
                    </p>
                )}
                <ApiErrorAlert error={error} />
            </form>
            {clashDialog}
        </Modal>
    );
};
