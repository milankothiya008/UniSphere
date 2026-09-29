import { STATUS_STYLES } from "../../lib/constants";
import { humanize } from "../../lib/format";

export const Badge = ({ tone = "neutral", dot = false, children, title }) => (
    <span className={`badge badge-${tone} ${dot ? "badge-dot" : ""}`} title={title}>
        {children}
    </span>
);

export const StatusBadge = ({ status, dot = true }) => {
    if (!status) {
        return null;
    }
    const [label, tone] = STATUS_STYLES[status] || [humanize(status), "neutral"];
    return (
        <Badge tone={tone} dot={dot}>
            {label}
        </Badge>
    );
};

// Clubs name their own roles, so pass the role's name as `label`; the key only picks the colour.
export const RoleBadge = ({ role, label }) => {
    if (!role) {
        return null;
    }
    const tone = role === "PRESIDENT" ? "gold" : role === "MEMBER" ? "neutral" : role === "VICE_PRESIDENT" ? "violet" : "ink";
    return <Badge tone={tone}>{label || humanize(role)}</Badge>;
};
