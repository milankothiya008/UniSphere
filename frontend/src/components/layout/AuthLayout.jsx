import { Link, Outlet } from "react-router-dom";
import { Award, CalendarCheck2, Megaphone, Sparkles, Users } from "lucide-react";

const POINTS = [
    [Users, "Start or join clubs with faculty mentors and clear roles."],
    [CalendarCheck2, "Discover events, check eligibility and register in one tap."],
    [Megaphone, "One campus feed instead of scattered WhatsApp groups and forms."],
    [Award, "Results and recognition published where everyone can see them."]
];

export const AuthLayout = () => (
    <div className="auth">
        <aside className="auth-aside">
            <Link to="/login" className="brand" style={{ padding: 0, height: "auto" }}>
                <span className="brand-mark">
                    <Sparkles size={18} />
                </span>
                <span className="brand-name">
                    Campus<span>Connect</span>
                </span>
            </Link>
            <div>
                <h1>
                    Everything happening on campus, <em>in one place.</em>
                </h1>
                <p>Clubs, events, registrations and results for your university community — verified with your university email.</p>
            </div>
            <div className="auth-points">
                {POINTS.map(([Icon, text]) => (
                    <div key={text}>
                        <Icon size={18} />
                        <span>{text}</span>
                    </div>
                ))}
            </div>
        </aside>
        <main className="auth-main">
            <div className="auth-card">
                <Outlet />
            </div>
        </main>
    </div>
);
