import { BadgeCheck, Bell, Building2, CalendarCheck2, CalendarX2, ClipboardCheck, FilePenLine, FileText, Hourglass, MailPlus, Megaphone, ScanLine, Sparkles, Trophy, Users, UsersRound } from "lucide-react";

// Icon and colour per notification type, so notification lists scan at a glance.
const STYLE = {
    EVENT_PUBLISHED: [Sparkles, "info"],
    EVENT_UPDATED: [Bell, "info"],
    EVENT_CANCELLED: [CalendarX2, "danger"],
    REGISTRATION_CONFIRMED: [CalendarCheck2, "success"],
    REGISTRATION_REMOVED: [CalendarX2, "danger"],
    WAITLISTED: [Hourglass, "warning"],
    RESULT_PUBLISHED: [Trophy, "gold"],
    ROUND_RESULTS: [Trophy, "gold"],
    ANNOUNCEMENT: [Megaphone, "violet"],
    EVENT_REVIEW: [ClipboardCheck, "violet"],
    EVENT_CHANGES_REVIEW: [FilePenLine, "violet"],
    TEAM_INVITE: [MailPlus, "info"],
    TEAM_UPDATE: [UsersRound, "violet"],
    CHECK_IN_OPEN: [ScanLine, "info"],
    ATTENDANCE_MARKED: [BadgeCheck, "success"],
    EVENT_APPROVED: [ClipboardCheck, "success"],
    EVENT_CHANGES_REQUESTED: [ClipboardCheck, "warning"],
    EVENT_REJECTED: [ClipboardCheck, "danger"],
    MEMBERSHIP_REQUEST: [Users, "info"],
    MEMBERSHIP_APPROVED: [Users, "success"],
    MEMBERSHIP_REJECTED: [Users, "danger"],
    CLUB_ROLE_CHANGED: [Users, "violet"],
    CLUB_REQUEST_UPDATE: [FileText, "info"],
    CLUB_UPDATE: [Building2, "info"],
    NEW_CLUB: [Building2, "success"]
};

export const NotificationIcon = ({ type, size = 14 }) => {
    const [Icon, tone] = STYLE[type] || [Bell, "neutral"];
    return (
        <span className={`action-icon tone-${tone}`} aria-hidden="true">
            <Icon size={size} />
        </span>
    );
};
