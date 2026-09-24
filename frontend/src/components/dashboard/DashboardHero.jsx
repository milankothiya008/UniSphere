import { Link } from "react-router-dom";
import { UNIVERSITY_TIMEZONE } from "../../lib/format";

export const greeting = () => {
    const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: UNIVERSITY_TIMEZONE }).format(new Date()));
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

// "Thursday, 24 September"
export const todayLabel = () =>
    new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: UNIVERSITY_TIMEZONE }).format(new Date());

// Key numbers shown inside the banner: [{ label, value, to, icon }]
const HeroStats = ({ stats }) => (
    <div className="hero-stats">
        {stats.map(({ label, value, to, icon: Icon }) => {
            const body = (
                <>
                    <span className="hero-stat-value">{value}</span>
                    <span className="hero-stat-label">
                        {Icon && <Icon size={13} />} {label}
                    </span>
                </>
            );
            return to ? (
                <Link key={label} to={to} className="hero-stat">
                    {body}
                </Link>
            ) : (
                <div key={label} className="hero-stat">
                    {body}
                </div>
            );
        })}
    </div>
);

// Dashboard banner. With `aside`, the banner splits into text + actions on the left and the aside on the right.
export const Hero = ({ title, subtitle, actions, aside, eyebrow, stats }) => (
    <section className={`hero hero-dash ${aside ? "hero-split" : ""}`}>
        <div className="hero-glow" aria-hidden="true" />
        <div className="stack hero-main">
            <div className="stack-sm">
                {eyebrow && <span className="hero-eyebrow">{eyebrow}</span>}
                <h1>{title}</h1>
                {subtitle && <p className="hero-subtitle">{subtitle}</p>}
            </div>
            {stats?.length > 0 && <HeroStats stats={stats} />}
            {actions && <div className="row hero-actions">{actions}</div>}
        </div>
        {aside}
    </section>
);
