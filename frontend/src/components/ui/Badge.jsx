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

export const RoleBadge = ({ role }) => {
    if (!role) {
        return null;
    }
    const tone = role === "PRESIDENT" ? "gold" : role === "MEMBER" ? "neutral" : "ink";
    return <Badge tone={tone}>{humanize(role)}</Badge>;
};
