import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Save } from "lucide-react";
import { authApi, userApi } from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiErrorAlert, Avatar, Badge, Button, Card, Input, PageHeader } from "../components/ui";
import { ROLE_LABELS } from "../lib/constants";
import { batchLabel, formatDate } from "../lib/format";
import { passwordProblems } from "../lib/validation";
import { formatPhone, normalizePhone, phoneInputValue } from "../lib/phone";
import { useWorkspace } from "../context/WorkspaceContext";

const SettingsPage = () => {
    const { user, setUser, logout } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const { approvedMemberships } = useWorkspace();
    const [name, setName] = useState(user.name);
    const [phone, setPhone] = useState(phoneInputValue(user.phone));
    const [savingName, setSavingName] = useState(false);
    const [nameError, setNameError] = useState(null);
    const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState(null);

    const phoneValue = phone.trim() ? normalizePhone(phone) : null;
    const phoneInvalid = Boolean(phone.trim()) && !phoneValue;
    const isMember = approvedMemberships.length > 0;
    const phoneMissing = isMember && !phone.trim();
    const changed = name.trim() !== user.name || phoneValue !== (user.phone || null);

    const saveName = async (event) => {
        event.preventDefault();
        setSavingName(true);
        setNameError(null);
        try {
            const response = await userApi.update(user._id, { name: name.trim(), phone: phoneValue });
            setUser((prev) => ({ ...prev, name: response.data.name, phone: response.data.phone }));
            setPhone(phoneInputValue(response.data.phone));
            toast.success("Profile updated");
        } catch (err) {
            setNameError(err);
        } finally {
            setSavingName(false);
        }
    };

    const problems = passwordProblems(passwords.newPassword);
    const mismatch = passwords.confirm && passwords.confirm !== passwords.newPassword;

    const changePassword = async (event) => {
        event.preventDefault();
        setSavingPassword(true);
        setPasswordError(null);
        try {
            await authApi.changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
            toast.success("Password changed. Please sign in again.");
            await logout();
            navigate("/login", { replace: true });
        } catch (err) {
            setPasswordError(err);
        } finally {
            setSavingPassword(false);
        }
    };

    return (
        <>
            <PageHeader title="Settings" back={{ to: "/profile", label: "Profile" }} />
            <div className="detail-layout">
                <div className="stack-lg">
                    <Card title="Profile">
                        <form className="stack" onSubmit={saveName}>
                            <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
                            <Input label="University email" value={user.email} disabled hint="Your email identifies your account and role and cannot be changed." />
                            <div id="mobile">
                                <Input
                                    label="Mobile number"
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="tel-national"
                                    placeholder="98765 43210"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    required={isMember}
                                    error={phoneInvalid ? "Enter a 10-digit Indian mobile number" : phoneMissing && user.phone ? "Club members need a mobile number, so it can be changed but not removed" : null}
                                    hint={
                                        user.accountType === "STUDENT"
                                            ? "Shown in club member lists to members of every club, club mentors and the admin — never to other students."
                                            : "Optional. Only the university admin can see it."
                                    }
                                />
                            </div>
                            <ApiErrorAlert error={nameError} />
                            <div className="form-actions">
                                <Button type="submit" loading={savingName} disabled={name.trim().length < 2 || phoneInvalid || phoneMissing || !changed}>
                                    <Save size={16} /> Save
                                </Button>
                            </div>
                        </form>
                    </Card>
                    <Card title="Change password">
                        <form className="stack" onSubmit={changePassword}>
                            <Input
                                label="Current password"
                                type="password"
                                autoComplete="current-password"
                                value={passwords.currentPassword}
                                onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
                                required
                            />
                            <div className="form-grid">
                                <Input
                                    label="New password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={passwords.newPassword}
                                    onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
                                    error={passwords.newPassword && problems.length ? `Needs ${problems.join(", ")}` : null}
                                    required
                                />
                                <Input
                                    label="Confirm new password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={passwords.confirm}
                                    onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                                    error={mismatch ? "Passwords do not match" : null}
                                    required
                                />
                            </div>
                            <ApiErrorAlert error={passwordError} />
                            <div className="form-actions">
                                <Button type="submit" loading={savingPassword} disabled={!passwords.currentPassword || problems.length > 0 || !passwords.confirm || mismatch}>
                                    <KeyRound size={16} /> Change password
                                </Button>
                            </div>
                        </form>
                    </Card>
                </div>
                <Card>
                    <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
                        <Avatar name={user.name} size="lg" />
                        <div>
                            <h2>{user.name}</h2>
                            <span className="subtle">{user.email}</span>
                        </div>
                        <div className="row" style={{ justifyContent: "center" }}>
                            <Badge tone="ink">{ROLE_LABELS[user.globalRole]}</Badge>
                            {user.departmentCode && <Badge>{user.departmentCode}</Badge>}
                            {user.batchCode && <Badge>Batch {batchLabel(user.batchCode)}</Badge>}
                        </div>
                        {user.phone && <span className="subtle">{formatPhone(user.phone)}</span>}
                        {user.createdAt && <span className="subtle">Member since {formatDate(user.createdAt)}</span>}
                    </div>
                </Card>
            </div>
        </>
    );
};

export default SettingsPage;
