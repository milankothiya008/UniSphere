import { NavLink, Link } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { initials } from "../../lib/format";

// Top-level pages get the animated dark banner; pages with a back link (details, forms) get the lighter variant.
export const PageHeader = ({ eyebrow, title, description, actions, back }) => (
    <>
        {back && (
            <Link to={back.to} className="back-link">
                <ArrowLeft size={15} /> {back.label}
            </Link>
        )}
        <header className={`page-header page-hero ${back ? "page-hero-soft" : ""}`}>
            {!back && (
                <span className="page-hero-orbs" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </span>
            )}
            <div className="page-hero-copy">
                {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                <h1>{title}</h1>
                {description && <p>{description}</p>}
            </div>
            {actions && <div className="row page-hero-actions">{actions}</div>}
        </header>
    </>
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
        {src ? <img src={src} alt="" /> : initials(name)}
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
