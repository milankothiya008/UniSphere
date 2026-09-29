import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    Award,
    BarChart3,
    BellRing,
    Building2,
    CalendarCheck2,
    ClipboardCheck,
    FileSignature,
    FileText,
    GraduationCap,
    Home,
    Images,
    LayoutDashboard,
    LogOut,
    MapPin,
    Menu,
    Newspaper,
    Settings2,
    ShieldCheck,
    Sparkles,
    User,
    Users,
    Wrench
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { Avatar } from "../ui";
import { ROLE_LABELS } from "../../lib/constants";
import { NotificationBell } from "./NotificationBell";

const NavItem = ({ to, icon: Icon, label, end, count }) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
        <Icon size={18} />
        <span>{label}</span>
        {count ? <span className="nav-count">{count}</span> : null}
    </NavLink>
);

const NavSection = ({ title, children }) => (
    <div className="nav-section">
        {title && <div className="nav-section-title">{title}</div>}
        {children}
    </div>
);

const Sidebar = () => {
    const { isStudent, isFaculty, isAdmin } = useAuth();
    const { officerClubs, eventClubs, mentoredClubs } = useWorkspace();
    const managesEvents = isFaculty || eventClubs.length > 0 || officerClubs.length > 0;

    return (
        <aside className="sidebar" aria-label="Main navigation">
            <Link to="/dashboard" className="brand">
                <span className="brand-mark">
                    <Sparkles size={18} />
                </span>
                <span className="brand-name">
                    Campus<span>Connect</span>
                </span>
            </Link>
            <nav className="sidebar-nav">
                <NavSection>
                    <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
                    <NavItem to="/feed" icon={Newspaper} label="Campus feed" />
                    <NavItem to="/clubs" icon={Building2} label="Clubs" end />
                    <NavItem to="/results" icon={Award} label="Results" />
                    <NavItem to="/gallery" icon={Images} label="Gallery" />
                </NavSection>

                {isStudent && (
                    <NavSection title="My activity">
                        <NavItem to="/my-registrations" icon={CalendarCheck2} label="My registrations" />
                        <NavItem to="/my-applications" icon={FileSignature} label="My applications" />
                        <NavItem to="/club-requests" icon={FileText} label="Club requests" />
                    </NavSection>
                )}

                {managesEvents && (
                    <NavSection title={isStudent ? "Club workspace" : "Event management"}>
                        <NavItem to="/events/manage" icon={Wrench} label="Manage events" />
                        {officerClubs.slice(0, 4).map((membership) => (
                            <NavItem key={membership.club._id} to={`/clubs/${membership.club._id}`} icon={Users} label={membership.club.name} />
                        ))}
                    </NavSection>
                )}

                {isFaculty && (
                    <NavSection title="Faculty">
                        <NavItem to="/faculty" icon={ClipboardCheck} label="Reviews" end />
                        <NavItem to="/faculty/clubs" icon={GraduationCap} label="Mentored clubs" count={mentoredClubs.length || null} />
                        <NavItem to="/club-requests" icon={FileText} label="Club requests" />
                    </NavSection>
                )}

                {isAdmin && (
                    <NavSection title="Administration">
                        <NavItem to="/admin" icon={BarChart3} label="Overview" end />
                        <NavItem to="/admin/club-requests" icon={ShieldCheck} label="Club approvals" />
                        <NavItem to="/admin/clubs" icon={Building2} label="All clubs" />
                        <NavItem to="/admin/users" icon={Users} label="Users" />
                        <NavItem to="/admin/faculty" icon={GraduationCap} label="Faculty & mentors" />
                        <NavItem to="/admin/academics" icon={Settings2} label="Departments & batches" />
                        <NavItem to="/admin/venues" icon={MapPin} label="Venues" />
                    </NavSection>
                )}
            </nav>
            <div className="sidebar-footer">CampusConnect · University club & event platform</div>
        </aside>
    );
};

const UserMenu = () => {
    const { user, logout } = useAuth();
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        const close = (event) => !boxRef.current?.contains(event.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const signOut = async () => {
        setOpen(false);
        await logout();
        navigate("/login", { replace: true });
    };

    return (
        <div style={{ position: "relative" }} ref={boxRef}>
            <button type="button" className="user-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account menu">
                <Avatar name={user.name} />
                <span className="who">
                    <strong>{user.name}</strong>
                    <span>{ROLE_LABELS[user.globalRole]}</span>
                </span>
            </button>
            {open && (
                <div className="popover">
                    <div style={{ padding: "8px 10px 10px" }}>
                        <strong style={{ display: "block" }}>{user.name}</strong>
                        <span className="subtle">{user.email}</span>
                    </div>
                    <div className="menu-divider" />
                    <Link to="/dashboard" className="menu-item" onClick={() => setOpen(false)}>
                        <Home size={16} /> Dashboard
                    </Link>
                    <Link to="/profile" className="menu-item" onClick={() => setOpen(false)}>
                        <User size={16} /> Profile & security
                    </Link>
                    <Link to="/settings/notifications" className="menu-item" onClick={() => setOpen(false)}>
                        <BellRing size={16} /> Notification settings
                    </Link>
                    <div className="menu-divider" />
                    <button type="button" className="menu-item" onClick={signOut}>
                        <LogOut size={16} /> Sign out
                    </button>
                </div>
            )}
        </div>
    );
};

export const AppShell = () => {
    const [navOpen, setNavOpen] = useState(false);
    const location = useLocation();

    useEffect(() => {
        setNavOpen(false);
        window.scrollTo(0, 0);
    }, [location.pathname]);

    return (
        <div className={`shell ${navOpen ? "nav-open" : ""}`}>
            <Sidebar />
            <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />
            <div className="main">
                <header className="topbar">
                    <button type="button" className="icon-button menu-toggle" onClick={() => setNavOpen(true)} aria-label="Open navigation">
                        <Menu size={20} />
                    </button>
                    <div className="topbar-actions">
                        <NotificationBell />
                        <UserMenu />
                    </div>
                </header>
                <main className="content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};
