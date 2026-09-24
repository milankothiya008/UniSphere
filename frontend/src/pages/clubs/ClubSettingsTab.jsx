import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Crown, GraduationCap, Save, ShieldAlert } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { Alert, ApiErrorAlert, Avatar, Button, Card, ConfirmDialog, ErrorState, ImageUpload, Input, Select, StatusBadge, Textarea, UserPicker } from "../../components/ui";
import { CLUB_CATEGORIES, PERMISSIONS } from "../../lib/constants";
import { departmentsLabel, humanize } from "../../lib/format";
import { scopeDepartments } from "../../lib/eligibility";
import { linkProblem, PHONE_PATTERN, SOCIAL_PLATFORMS } from "../../lib/clubLinks";
import { SocialIcon } from "../../components/clubs/SocialIcon";

const emptyLinks = () => Object.fromEntries(SOCIAL_PLATFORMS.map((platform) => [platform.key, ""]));

const profileFromClub = (club) => ({
    name: club.name,
    tagline: club.tagline || "",
    description: club.description,
    purpose: club.purpose || "",
    category: club.category,
    logo: club.logo || "",
    coverImage: club.coverImage || "",
    website: club.website || "",
    contactEmail: club.contactEmail || "",
    contactPhone: club.contactPhone || "",
    meetingSchedule: club.meetingSchedule || "",
    meetingLocation: club.meetingLocation || "",
    socialLinks: { ...emptyLinks(), ...Object.fromEntries(Object.entries(club.socialLinks || {}).map(([key, value]) => [key, value || ""])) }
});

const profileErrors = (form) => {
    const errors = {};
    if ((form.name || "").trim().length < 3) errors.name = "At least 3 characters";
    if ((form.description || "").trim().length < 10) errors.description = "At least 10 characters";
    const website = linkProblem(form.website, { label: "Website" });
    if (website) errors.website = website;
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) errors.contactEmail = "Enter a valid email address";
    if (form.contactPhone && !PHONE_PATTERN.test(form.contactPhone.trim())) errors.contactPhone = "Enter a valid phone number, e.g. +91 98765 43210";
    SOCIAL_PLATFORMS.forEach((platform) => {
        const problem = linkProblem(form.socialLinks?.[platform.key], platform);
        if (problem) errors[`social.${platform.key}`] = problem;
    });
    return errors;
};

const DetailsForm = ({ club, onSaved }) => {
    const toast = useToast();
    const [form, setForm] = useState(() => profileFromClub(club));
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        setForm(profileFromClub(club));
    }, [club]);

    const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value?.target ? value.target.value : value }));
    const setSocial = (key) => (event) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, [key]: event.target.value } }));

    const errors = profileErrors(form);
    const hasErrors = Object.keys(errors).length > 0;
    // Link mistakes show as you type; required-field mistakes after the first save attempt.
    const show = (name, value) => (touched || value ? errors[name] : undefined);

    const save = async (event) => {
        event.preventDefault();
        setTouched(true);
        if (hasErrors) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            await clubApi.update(club._id, {
                ...form,
                name: form.name.trim(),
                tagline: form.tagline.trim(),
                website: form.website.trim(),
                contactEmail: form.contactEmail.trim(),
                contactPhone: form.contactPhone.trim(),
                socialLinks: Object.fromEntries(Object.entries(form.socialLinks).map(([key, value]) => [key, value.trim()]))
            });
            toast.success("Club profile saved");
            onSaved();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <form className="stack-lg" onSubmit={save} noValidate>
            <Card title="Club profile">
                <div className="stack">
                    <ImageUpload label="Cover image" value={form.coverImage} onChange={set("coverImage")} folder="club-covers" wide hint="Shown behind your club's header. A wide image works best (e.g. 1600 × 500)." />
                    <ImageUpload label="Logo" value={form.logo} onChange={set("logo")} folder="club-logos" />
                    <div className="form-grid">
                        <Input label="Name" value={form.name} onChange={set("name")} maxLength={120} error={show("name")} required />
                        <Select label="Category" value={form.category} onChange={set("category")} options={CLUB_CATEGORIES.map((value) => ({ value, label: humanize(value) }))} />
                        <Input
                            className="span-2"
                            label="Tagline"
                            value={form.tagline}
                            onChange={set("tagline")}
                            maxLength={140}
                            placeholder="One line that sums up your club"
                            hint={`${form.tagline.length}/140 · shown on club cards and the club header`}
                        />
                        <Textarea className="span-2" label="Description" value={form.description} onChange={set("description")} rows={5} maxLength={4000} error={show("description")} required />
                        <Textarea className="span-2" label="Purpose" value={form.purpose} onChange={set("purpose")} rows={3} maxLength={2000} />
                    </div>
                </div>
            </Card>

            <Card title="Contact & website">
                <div className="form-grid">
                    <Input
                        className="span-2"
                        label="Website"
                        type="url"
                        inputMode="url"
                        placeholder="https://yourclub.ddu.ac.in"
                        value={form.website}
                        onChange={set("website")}
                        error={show("website", form.website)}
                        hint="Your club's own site, blog or link page"
                    />
                    <Input label="Contact email" type="email" value={form.contactEmail} onChange={set("contactEmail")} error={show("contactEmail", form.contactEmail)} />
                    <Input label="Contact phone" type="tel" placeholder="+91 98765 43210" value={form.contactPhone} onChange={set("contactPhone")} maxLength={20} error={show("contactPhone", form.contactPhone)} />
                </div>
            </Card>

            <Card title="Meetings">
                <div className="form-grid">
                    <Input label="When you meet" placeholder="Every Friday, 4:00–5:30 PM" value={form.meetingSchedule} onChange={set("meetingSchedule")} maxLength={120} />
                    <Input label="Where you meet" placeholder="Lab 204, CE Block" value={form.meetingLocation} onChange={set("meetingLocation")} maxLength={120} />
                </div>
            </Card>

            <Card title="Social media">
                <p className="subtle" style={{ margin: "0 0 14px" }}>Add the profiles your club uses and leave the rest empty. Links must point to the platform itself.</p>
                <div className="form-grid">
                    {SOCIAL_PLATFORMS.map((platform) => (
                        <div key={platform.key} className="social-field">
                            <span className={`social-field-icon social-${platform.key}`} aria-hidden="true">
                                <SocialIcon platform={platform.key} size={16} />
                            </span>
                            <Input
                                label={platform.label}
                                type="url"
                                inputMode="url"
                                placeholder={platform.placeholder}
                                value={form.socialLinks[platform.key]}
                                onChange={setSocial(platform.key)}
                                error={show(`social.${platform.key}`, form.socialLinks[platform.key])}
                            />
                        </div>
                    ))}
                </div>
            </Card>

            {touched && hasErrors && <Alert type="error">Please fix the highlighted fields.</Alert>}
            <ApiErrorAlert error={error} />
            <div className="form-actions">
                <Button type="submit" loading={pending}>
                    <Save size={16} /> Save profile
                </Button>
            </div>
        </form>
    );
};

const PresidentCard = ({ club, onSaved }) => {
    const toast = useToast();
    const [candidate, setCandidate] = useState(null);

    const appoint = async () => {
        await clubApi.assignPresident(club._id, candidate._id);
        toast.success(`${candidate.name} is now president of ${club.name}`);
        onSaved();
    };

    return (
        <Card title={<h2 className="row"><Crown size={17} /> Club president</h2>}>
            <div className="stack">
                <p className="subtle">
                    As faculty mentor you appoint the president. {club.status === "APPROVED" ? "Appointing a president activates the club." : "The current president becomes a regular member."}
                </p>
                {club.president && (
                    <div className="row">
                        <Avatar name={club.president.name} size="sm" />
                        <span>
                            <strong>{club.president.name}</strong> <span className="subtle">{club.president.email}</span>
                        </span>
                    </div>
                )}
                <UserPicker
                    label={club.president ? "Appoint a new president" : "Choose a student"}
                    hint={club.allDepartments ? undefined : `The president must be a ${departmentsLabel(club)} student.`}
                    accountType="STUDENT"
                    departments={scopeDepartments(club)}
                    onSelect={setCandidate}
                    exclude={club.president ? [club.president._id] : []}
                />
            </div>
            <ConfirmDialog
                open={Boolean(candidate)}
                onClose={() => setCandidate(null)}
                onConfirm={appoint}
                title={`Appoint ${candidate?.name} as president?`}
                description="They will get full club management permissions and be notified by email."
                confirmLabel="Appoint president"
            />
        </Card>
    );
};

const AdminCard = ({ club, onSaved }) => {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [mentor, setMentor] = useState(null);

    const changeStatus = async (reason) => {
        await clubApi.setStatus(club._id, status, reason || undefined);
        toast.success(`Club is now ${humanize(status).toLowerCase()}`);
        onSaved();
    };

    const changeMentor = async () => {
        await clubApi.setMentor(club._id, mentor._id);
        toast.success(`${mentor.name} is now the faculty mentor`);
        onSaved();
    };

    const options = ["ACTIVE", "SUSPENDED", "ARCHIVED"].filter((value) => value !== club.status);

    return (
        <Card title={<h2 className="row"><ShieldAlert size={17} /> University administration</h2>}>
            <div className="stack">
                <div className="row-between">
                    <span>
                        Status: <StatusBadge status={club.status} />
                    </span>
                    <div className="row">
                        {options.map((value) => (
                            <Button key={value} size="sm" variant={value === "ACTIVE" ? "success" : "secondary"} onClick={() => setStatus(value)} disabled={value === "ACTIVE" && !club.president}>
                                {value === "ACTIVE" ? "Reactivate" : humanize(value)}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="stack-sm">
                    <span className="row small">
                        <GraduationCap size={15} /> Current mentor: <strong>{club.mentor?.name || "None"}</strong>
                    </span>
                    <UserPicker
                        label="Reassign faculty mentor"
                        hint={club.allDepartments ? "Any faculty member can mentor this club." : `Mentor must be faculty from ${departmentsLabel(club)}.`}
                        accountType="FACULTY"
                        departments={scopeDepartments(club)}
                        onSelect={setMentor}
                        exclude={club.mentor ? [club.mentor._id] : []}
                    />
                </div>
            </div>
            <ConfirmDialog
                open={Boolean(status)}
                onClose={() => setStatus(null)}
                onConfirm={changeStatus}
                title={`Change status to ${humanize(status || "")}?`}
                description={status === "SUSPENDED" ? "Suspended clubs cannot create or publish events or accept members." : undefined}
                confirmLabel="Change status"
                variant={status === "ACTIVE" ? "success" : "danger"}
                reasonLabel="Reason"
            />
            <ConfirmDialog
                open={Boolean(mentor)}
                onClose={() => setMentor(null)}
                onConfirm={changeMentor}
                title={`Make ${mentor?.name} the faculty mentor?`}
                description="The new mentor will review this club's events from now on."
                confirmLabel="Assign mentor"
            />
        </Card>
    );
};

const ClubSettingsTab = () => {
    const { club, reload } = useOutletContext();
    const { reloadClubs } = useWorkspace();
    const viewer = club.viewer || {};
    // Each party sees only its own powers: club leadership edits the profile, the mentor appoints the
    // president, and the university admin changes status or reassigns the mentor.
    const canEditDetails = viewer.permissions?.includes(PERMISSIONS.MANAGE_CLUB);
    const canAppointPresident = viewer.isMentor && ["APPROVED", "ACTIVE"].includes(club.status);
    const canAdminister = viewer.isAdmin;

    if (!canEditDetails && !viewer.isMentor && !canAdminister) {
        return <ErrorState error={{ status: 403, message: "Only the club's leadership, its faculty mentor and the university admin can open this page." }} />;
    }

    const saved = () => {
        reload();
        reloadClubs();
    };

    const sideCards = (
        <div className="stack">
            {canAppointPresident && <PresidentCard club={club} onSaved={saved} />}
            {canAdminister && <AdminCard club={club} onSaved={saved} />}
            {canEditDetails && (
                <Alert type="info">The president is appointed by the club's faculty mentor. Contact them to hand over leadership.</Alert>
            )}
            {!canEditDetails && (
                <Alert type="info">Club details such as the name, logo and description are managed by the club's own leadership.</Alert>
            )}
        </div>
    );

    return canEditDetails ? (
        <div className="detail-layout">
            <DetailsForm club={club} onSaved={saved} />
            {sideCards}
        </div>
    ) : (
        <div style={{ maxWidth: 640 }}>{sideCards}</div>
    );
};

export default ClubSettingsTab;
