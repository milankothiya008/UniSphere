import { clubApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ConfirmDialog } from "../ui";

// What each status change does, in plain words for the admin.
const COPY = {
    SUSPENDED: {
        title: (club) => `Suspend ${club.name}?`,
        description:
            "Upcoming events and recruitment go on hold: students can't see them, register or apply, and the club can't publish anything new. Nothing is deleted. The president, the mentor, registered students and applicants are emailed.",
        reasonLabel: "Reason (emailed to the president and mentor)",
        confirm: "Suspend club",
        variant: "danger",
        toast: (club) => `${club.name} suspended — everyone involved is being emailed`
    },
    ARCHIVED: {
        title: (club) => `Archive ${club.name}?`,
        description: "The club is closed and hidden from students; its events and recruitment stay on hold. You can reactivate it later. The president and mentor are emailed.",
        reasonLabel: "Reason (emailed to the president and mentor)",
        confirm: "Archive club",
        variant: "danger",
        toast: (club) => `${club.name} archived`
    },
    ACTIVE: {
        title: (club) => `Reactivate ${club.name}?`,
        description:
            "Everything on hold resumes. Recruitment and offer deadlines move on by the time the club was paused, and registered students and applicants are told their event or application is back on.",
        reasonLabel: "Note for the president and mentor (optional)",
        confirm: "Reactivate club",
        variant: "success",
        toast: (club) => `${club.name} is active again — everyone involved is being emailed`
    }
};

/** Suspend, archive or reactivate a club (university admin). `status` is the target status. */
export const ClubStatusDialog = ({ club, status, onClose, onDone }) => {
    const toast = useToast();
    const copy = COPY[status];
    if (!club || !copy) {
        return null;
    }
    const change = async (reason) => {
        const response = await clubApi.setStatus(club._id, status, reason || undefined);
        toast.success(copy.toast(club));
        onDone?.(response.data);
    };
    return (
        <ConfirmDialog
            open
            onClose={onClose}
            onConfirm={change}
            title={copy.title(club)}
            description={copy.description}
            reasonLabel={copy.reasonLabel}
            reasonRequired={status !== "ACTIVE"}
            reasonPlaceholder={status === "ACTIVE" ? "e.g. Review completed — thank you for your patience" : "e.g. Safety review of the workshop equipment"}
            confirmLabel={copy.confirm}
            variant={copy.variant}
        />
    );
};

/** The status actions the admin can take on a club, for an ActionMenu. */
export const clubStatusActions = (club, open, icons) => [
    { label: "Suspend", icon: icons.suspend, onClick: () => open("SUSPENDED"), hidden: club.status !== "ACTIVE", danger: true },
    { label: "Reactivate", icon: icons.reactivate, onClick: () => open("ACTIVE"), hidden: !["SUSPENDED", "ARCHIVED"].includes(club.status), disabled: !club.president },
    { label: "Archive", icon: icons.archive, onClick: () => open("ARCHIVED"), hidden: !["ACTIVE", "SUSPENDED", "APPROVED"].includes(club.status), danger: true }
];
