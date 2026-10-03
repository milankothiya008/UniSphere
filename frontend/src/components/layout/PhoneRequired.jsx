import { useState } from "react";
import { Smartphone } from "lucide-react";
import { userApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, Input, Modal } from "../ui";
import { normalizePhone } from "../../lib/phone";

/**
 * Everyone gives a mobile number when they sign up. Accounts made before that are asked once, here, and
 * can carry on as soon as it's saved.
 */
export const PhoneRequired = () => {
    const { user, setUser } = useAuth();
    const toast = useToast();
    const [value, setValue] = useState("");
    const [touched, setTouched] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    if (!user || user.phone || user.globalRole === "ADMIN" || !["STUDENT", "FACULTY"].includes(user.accountType)) return null;
    const phone = normalizePhone(value);
    const problem = !value.trim() ? "Enter your mobile number" : !phone ? "Enter a 10-digit Indian mobile number" : null;

    const save = async (event) => {
        event.preventDefault();
        setTouched(true);
        if (problem) return;
        setPending(true);
        setError(null);
        try {
            const response = await userApi.update(user._id, { phone });
            setUser((prev) => ({ ...prev, phone: response.data.phone }));
            toast.success("Mobile number saved");
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open
            title="Add your mobile number"
            description="It's now part of every account, so clubs and mentors can reach you about events you join."
            footer={
                <Button type="submit" form="phone-required" loading={pending}>
                    <Smartphone size={16} /> Save and continue
                </Button>
            }
        >
            <form id="phone-required" className="stack" onSubmit={save} noValidate>
                <Input
                    label="Mobile number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    onBlur={() => setTouched(true)}
                    error={touched && problem}
                    hint={
                        user.accountType === "FACULTY"
                            ? "Only club members and staff can see it."
                            : "Only your clubs, club leaders and faculty can see it — never other students."
                    }
                    required
                />
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};
