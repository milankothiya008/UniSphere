import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { Avatar, Badge, RoleBadge, StatusBadge } from "../ui";
import { departmentsLabel, humanize, plural } from "../../lib/format";

export const ClubCard = ({ club, role, showStatus = false }) => (
    <Link to={`/clubs/${club._id}`} className="card card-link club-card">
        <div className="club-card-head">
            <Avatar name={club.name} src={club.logo} size="lg" square />
            <div style={{ minWidth: 0 }}>
                <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{club.name}</h3>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <Badge tone="ink">{humanize(club.category)}</Badge>
                    <Badge>{departmentsLabel(club)}</Badge>
                </div>
            </div>
        </div>
        {club.tagline && <p className="club-card-tagline">{club.tagline}</p>}
        <p>{club.description}</p>
        <div className="club-card-foot">
            <span className="row" style={{ gap: 6 }}>
                <Users size={14} />
                {club.memberCount !== undefined ? plural(club.memberCount, "member") : club.president?.name ? `President: ${club.president.name}` : ""}
            </span>
            {role ? <RoleBadge role={role} /> : showStatus ? <StatusBadge status={club.status} /> : null}
        </div>
    </Link>
);
