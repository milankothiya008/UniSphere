import { NavLink, Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { initials } from "../../lib/format";
import { imageUrl } from "../../lib/images";

// A compact title row: an optional back arrow, the club it belongs to, the title, one line of facts and
// the page's actions. No banners or blurbs.
export const PageHeader = ({ title, actions, back, club, meta }) => (
    <header className="page-header">
        {back && (
            <Link to={back.to} className="back-link" aria-label={back.label} title={back.label}>
                <ChevronLeft size={22} />
            </Link>
        )}
        <div className="page-header-title">
            {club && (
                <Link to={`/clubs/${club._id}`} className="page-header-club">
                    <Avatar name={club.name} src={club.logo} size="xs" /> {club.name}
                </Link>
            )}
            <h1>{title}</h1>
            {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {actions && <div className="row page-header-actions">{actions}</div>}
    </header>
);

// Instagram-style numbers row ("12 events · 340 members"). Items with `to` are links.
export const StatStrip = ({ items, className = "" }) => (
    <ul className={`stat-strip ${className}`}>
        {items.map(({ label, value, to }) => {
            const body = (
                <>
                    <b>{value ?? "–"}</b> <span>{label}</span>
                </>
            );
            return <li key={label}>{to ? <Link to={to}>{body}</Link> : body}</li>;
        })}
    </ul>
);

export const Card = ({ title, actions, footer, children, padded = true, className = "" }) => (
    <section className={`card ${className}`}>
        {(title || actions) && (
            <header className="card-header">
                {typeof title === "string" ? <h2>{title}</h2> : title}
                {actions && <div className="row">{actions}</div>}
            </header>
        )}
        {padded ? <div className="card-body">{children}</div> : children}
        {footer && <footer className="card-footer">{footer}</footer>}
    </section>
);

export const Avatar = ({ name, src, size, square = false }) => (
    <span className={`avatar ${size ? `avatar-${size}` : ""} ${square ? "avatar-square" : ""}`} aria-hidden="true">
        {src ? <img src={imageUrl(src, size === "xl" ? 240 : size === "lg" ? 96 : 48)} alt="" loading="lazy" decoding="async" /> : initials(name)}
    </span>
);

// tone picks the icon badge colour: ink (default), gold, success, violet, info or danger.
export const StatTile = ({ label, value, icon: Icon, hint, tone = "ink" }) => (
    <div className={`card stat stat-${tone}`}>
        <div className="stat-top">
            <span className="stat-label">{label}</span>
            {Icon && (
                <span className="stat-icon" aria-hidden="true">
                    <Icon size={17} />
                </span>
            )}
        </div>
        <span className="stat-value">{value ?? "—"}</span>
        {hint && <span className="stat-hint">{hint}</span>}
    </div>
);

export const Pagination = ({ meta, onPage }) => {
    if (!meta || meta.totalPages <= 1) {
        return null;
    }
    const { page, totalPages, total } = meta;
    return (
        <nav className="pagination" aria-label="Pagination">
            <span className="subtle">
                Page {page} of {totalPages} · {total} total
            </span>
            <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
                    <ChevronLeft size={15} /> Previous
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
                    Next <ChevronRight size={15} />
                </button>
            </div>
        </nav>
    );
};

// Tabs can be route links (`to`) or local buttons (`value` + onChange).
export const Tabs = ({ tabs, value, onChange }) => (
    <div className="tabs" role="tablist">
        {tabs.map((tab) =>
            tab.to ? (
                <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
                    {tab.icon && <tab.icon size={15} />}
                    {tab.label}
                    {tab.count !== undefined && tab.count !== null && <span className="count">{tab.count}</span>}
                </NavLink>
            ) : (
                <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={value === tab.value}
                    className={`tab ${value === tab.value ? "active" : ""}`}
                    onClick={() => onChange(tab.value)}
                >
                    {tab.icon && <tab.icon size={15} />}
                    {tab.label}
                    {tab.count !== undefined && tab.count !== null && <span className="count">{tab.count}</span>}
                </button>
            )
        )}
    </div>
);

export const Segmented = ({ options, value, onChange, label }) => (
    <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
            <button key={option.value} type="button" className={value === option.value ? "active" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
                {option.label}
            </button>
        ))}
    </div>
);

// `teams` switches the wording for team events, where the limit counts teams.
export const CapacityBar = ({ registered = 0, max, teams = false }) => {
    const unit = teams ? (registered === 1 ? "team" : "teams") : "registered";
    if (!max) {
        return <span className="subtle">{registered} {unit} · no limit</span>;
    }
    const percent = Math.min(100, Math.round((registered / max) * 100));
    return (
        <div className="stack-sm" style={{ gap: 5 }}>
            <div className="row-between subtle">
                <span>
                    {registered} / {max} {teams ? "teams" : "registered"}
                </span>
                <span>
                    {Math.max(0, max - registered)} {teams ? "places" : "seats"} left
                </span>
            </div>
            <div className={`progress ${percent >= 100 ? "full" : ""}`}>
                <span style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
};
