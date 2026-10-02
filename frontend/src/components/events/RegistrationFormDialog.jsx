import { useEffect, useId, useState } from "react";
import { ClipboardList, Send } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, Modal } from "../ui";
import { QuestionFields, answersMap, missingAnswer, toAnswers } from "../forms/QuestionFields";
import { batchLabel } from "../../lib/format";
import { formatPhone } from "../../lib/phone";

/** The registration form's questions for one person: everything on individual events; per role on team events. */
export const formQuestions = (event, role) => {
    const questions = event.registrationForm?.enabled ? event.registrationForm.questions || [] : [];
    if (event.participationMode !== "TEAM") return { member: questions, team: [] };
    return {
        member: questions.filter((question) => question.scope !== "TEAM"),
        team: role === "LEADER" ? questions.filter((question) => question.scope === "TEAM") : []
    };
};

/** What the club already knows from the student's account, shown so nobody types it twice. */
export const AccountDetails = () => {
    const { user } = useAuth();
    return (
        <div className="account-strip">
            <span className="small subtle">From your account</span>
            <strong>{user?.name}</strong>
            <span className="small">
                {[user?.email, user?.departmentCode, user?.batchCode && `Batch ${batchLabel(user.batchCode)}`, user?.phone && formatPhone(user.phone)]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
        </div>
    );
};

/**
 * Individual events with a registration form: answer the questions, then register (or, already registered,
 * change the answers until the event starts). Team members use it to join a team (`onSubmit` given).
 */
export const RegistrationFormDialog = ({ open, onClose, event, mode = "register", role = null, initial = null, onDone, onSubmit, title }) => {
    const toast = useToast();
    const formId = useId();
    const { member, team } = formQuestions(event, role);
    const [values, setValues] = useState({});
    const [teamValues, setTeamValues] = useState({});
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setValues(answersMap(initial?.answers || []));
            setTeamValues(answersMap(initial?.teamAnswers || []));
            setError(null);
        }
    }, [open, initial]);

    const missing = missingAnswer(member, values) || missingAnswer(team, teamValues);
    const full = event.registrationState === "FULL";

    const submit = async (submitEvent) => {
        submitEvent.preventDefault();
        if (missing) return;
        setPending(true);
        setError(null);
        const body = { answers: toAnswers(member, values), ...(team.length ? { teamAnswers: toAnswers(team, teamValues) } : {}) };
        try {
            if (onSubmit) {
                await onSubmit(body);
            } else if (mode === "edit") {
                await eventApi.updateMyAnswers(event._id, body);
                toast.success("Your answers were updated");
            } else {
                const response = await eventApi.register(event._id, body);
                if (response.data?.waitlisted)
                    toast.info(`The event is full — you're #${response.data.waitlistPosition} on the waitlist. We'll email you if a seat opens up.`);
                else toast.success("You're registered! A confirmation was sent to your email.");
            }
            onDone?.();
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
            title={title || (mode === "edit" ? "Your registration answers" : full ? `Join the waitlist for ${event.title}` : `Register for ${event.title}`)}
            description={mode === "edit" ? "You can change these until the event starts." : "The club asks a few questions for this event."}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form={formId} loading={pending} disabled={Boolean(missing)} title={missing ? `Answer "${missing.label}"` : undefined}>
                        {mode === "edit" ? (
                            "Save answers"
                        ) : (
                            <>
                                <Send size={16} /> {onSubmit ? "Join team" : full ? "Join waitlist" : "Register"}
                            </>
                        )}
                    </Button>
                </>
            }
        >
            <form id={formId} className="stack-lg" onSubmit={submit}>
                {mode !== "edit" && <AccountDetails />}
                {team.length > 0 && (
                    <section className="form-group">
                        <h3 className="form-group-title">For your team</h3>
                        <QuestionFields questions={team} values={teamValues} onChange={setTeamValues} idPrefix="team" />
                    </section>
                )}
                {member.length > 0 && (
                    <section className="form-group">
                        {team.length > 0 && <h3 className="form-group-title">About you</h3>}
                        <QuestionFields questions={member} values={values} onChange={setValues} idPrefix="me" />
                    </section>
                )}
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};

/** "Your answers" on the event page, with an Edit button while the event hasn't started. */
export const MyAnswersButton = ({ event, onChange }) => {
    const [open, setOpen] = useState(false);
    const role = event.viewer?.teamRole || null;
    const { member, team } = formQuestions(event, role);
    if (!event.myAnswers || (!member.length && !team.length) || new Date(event.startAt) <= new Date()) return null;
    return (
        <>
            <Button variant="secondary" block onClick={() => setOpen(true)}>
                <ClipboardList size={16} /> Your registration answers
            </Button>
            <RegistrationFormDialog
                open={open}
                onClose={() => setOpen(false)}
                event={event}
                mode="edit"
                role={role}
                initial={event.myAnswers}
                onDone={onChange}
            />
        </>
    );
};
