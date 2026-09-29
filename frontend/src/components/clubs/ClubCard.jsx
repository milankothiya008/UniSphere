import { Link } from "react-router-dom";
import { Megaphone, Users } from "lucide-react";
import { Avatar, Badge, RoleBadge, StatusBadge } from "../ui";
import { departmentsLabel, humanize, plural } from "../../lib/format";
import { categoryStyle, categoryVars } from "../../lib/eventVisuals";

const ClubArt = ({ category }) => {
    const Icon = categoryStyle(category).icon;
    return <Icon className="category-art" size={96} strokeWidth={1} aria-hidden="true" />;
};

export const ClubCard = ({ club, role, roleName, showStatus = false }) => (
    <Link to={`/clubs/${club._id}`} className="card card-link club-card" style={categoryVars(club.category)}>
        <div className="club-card-banner" style={club.coverImage ? { backgroundImage: `url("${String(club.coverImage).replace(/"/g, "%22")}")` } : undefined}>
            {!club.coverImage && <ClubArt category={club.category} />}
            {club.recruiting && (
                <span className={`club-card-recruiting ${club.recruiting.open ? "is-open" : ""}`}>
                    <Megaphone size={13} /> {club.recruiting.open ? "Recruiting now" : "Recruiting soon"}
                </span>
            )}
        </div>
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
            {role ? <RoleBadge role={role} label={roleName} /> : showStatus ? <StatusBadge status={club.status} /> : null}
        </div>
    </Link>
);
