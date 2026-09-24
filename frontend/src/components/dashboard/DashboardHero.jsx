import { UNIVERSITY_TIMEZONE } from "../../lib/format";

export const greeting = () => {
    const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: UNIVERSITY_TIMEZONE }).format(new Date()));
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

// Dashboard banner. With `aside`, the banner splits into text + actions on the left and the aside on the right.
export const Hero = ({ title, subtitle, actions, aside }) =>
    aside ? (
        <section className="hero hero-split">
            <div className="stack hero-main">
                <div className="stack-sm">
                    <h1>{title}</h1>
                    <p>{subtitle}</p>
                </div>
                {actions && <div className="row">{actions}</div>}
            </div>
            {aside}
        </section>
    ) : (
        <section className="hero">
            <div className="row-between" style={{ alignItems: "flex-end" }}>
                <div className="stack-sm">
                    <h1>{title}</h1>
                    <p>{subtitle}</p>
                </div>
                {actions && <div className="row">{actions}</div>}
            </div>
        </section>
    );
