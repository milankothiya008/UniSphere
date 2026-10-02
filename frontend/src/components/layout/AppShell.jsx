import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    BellRing,
    Building2,
    CalendarRange,
    ClipboardCheck,
    Compass,
    FileText,
    GraduationCap,
    Heart,
    Home,
    MapPin,
    Menu,
    PlusSquare,
    Settings,
    Settings2,
    ShieldCheck,
    LogOut,
    Moon,
    Sun,
    Users,
    Wrench
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useUnreadCount } from "../../hooks/useUnreadCount";
import { PERMISSIONS } from "../../lib/constants";
import { useTheme } from "../../lib/theme";
import { ActionMenu, Avatar } from "../ui";
import { CreateSheet, useCreateOptions } from "./CreateSheet";
import { ActivityBubble } from "./ActivityBubble";
import { PhoneRequired } from "./PhoneRequired";

const Brand = () => (
    <Link to="/feed" className="brand" aria-label="CampusConnect home">
        <span className="brand-mark" aria-hidden="true">
            C
        </span>
        <span className="brand-name">CampusConnect</span>
    </Link>
);

// Activity shows Instagram's red dot rather than a number; the bubble says what's new.
const Count = ({ value, dot }) => {
    if (!(value > 0)) return null;
    return dot ? <span className="nav-dot" aria-hidden="true" /> : <span className="nav-badge">{value > 99 ? "99+" : value}</span>;
};

// The main destinations: the same five on the side bar and the phone's bottom tabs.
const usePrimaryNav = () => {
    const { user, isFaculty, isAdmin } = useAuth();
    const unread = useUnreadCount();
    const canCreate = useCreateOptions().length > 0;
    const { pathname } = useLocation();

    const role = isAdmin
        ? { key: "role", to: "/dashboard", icon: ShieldCheck, label: "Admin" }
        : isFaculty
          ? { key: "role", to: "/dashboard", icon: ClipboardCheck, label: "Reviews" }
          : canCreate
            ? { key: "create", icon: PlusSquare, label: "Create" }
            : null;

    return [
        { key: "home", to: "/feed", icon: Home, label: "Home", active: pathname === "/feed" },
        { key: "explore", to: "/explore", icon: Compass, label: "Explore" },
        role,
        { key: "activity", to: "/activity", icon: Heart, label: "Activity", count: unread, dot: true, active: ["/activity", "/notifications"].includes(pathname) },
        { key: "profile", to: "/profile", label: "Profile", avatar: user }
    ].filter(Boolean);
};

// Everything else: role pages, settings and sign-out. A list on wide screens, a menu on phones.
const useSecondaryNav = () => {
    const { isStudent, isFaculty, isAdmin } = useAuth();
    const { officerClubs, eventClubs } = useWorkspace();
    const managesEvents = isFaculty || eventClubs.length > 0 || officerClubs.length > 0;
    // The campus-wide planner: mentors, the admin and officers who create or publish events.
    const plansEvents =
        isFaculty || isAdmin || officerClubs.some((m) => m.permissions?.includes(PERMISSIONS.MANAGE_EVENTS) || m.permissions?.includes(PERMISSIONS.PUBLISH_EVENTS));

    return [
        managesEvents && { to: "/events/manage", icon: Wrench, label: "Manage events" },
        plansEvents && { to: "/events/planner", icon: CalendarRange, label: "Event planner" },
        isFaculty && { to: "/faculty/clubs", icon: GraduationCap, label: "Mentored clubs" },
        (isStudent || isFaculty) && { to: "/club-requests", icon: FileText, label: "Club requests" },
        ...(isAdmin
            ? [
                  { to: "/admin/club-requests", icon: ShieldCheck, label: "Club approvals" },
                  { to: "/admin/clubs", icon: Building2, label: "All clubs" },
                  { to: "/admin/users", icon: Users, label: "Users" },
                  { to: "/admin/faculty", icon: GraduationCap, label: "Faculty & mentors" },
                  { to: "/admin/academics", icon: Settings2, label: "Departments & batches" },
                  { to: "/admin/venues", icon: MapPin, label: "Venues & labs" }
              ]
            : [])
    ].filter(Boolean);
};

const useAccountMenu = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const [theme, changeTheme] = useTheme();
    const dark = theme === "dark" || (theme === "system" && document.documentElement.dataset.theme === "dark");
    return [
        { label: "Settings", icon: Settings, onClick: () => navigate("/settings") },
        { label: dark ? "Light mode" : "Dark mode", icon: dark ? Sun : Moon, onClick: () => changeTheme(dark ? "light" : "dark") },
        { label: "Email settings", icon: BellRing, onClick: () => navigate("/settings/notifications") },
        "divider",
        {
            label: "Sign out",
            icon: LogOut,
            onClick: async () => {
                await logout();
                navigate("/login", { replace: true });
            }
        }
    ];
};

const PrimaryLink = ({ item, onCreate }) => {
    const body = (
        <>
            <span className="nav-icon">
                {item.avatar ? <Avatar name={item.avatar.name} src={item.avatar.avatar} size="xs" /> : <item.icon size={24} strokeWidth={1.9} />}
                <Count value={item.count} dot={item.dot} />
            </span>
            <span className="nav-label">{item.label}</span>
        </>
    );
    if (!item.to) {
        return (
            <button type="button" className="nav-item" onClick={onCreate} title={item.label}>
                {body}
            </button>
        );
    }
    return (
        <NavLink
            to={item.to}
            title={item.label}
            aria-label={item.count ? `${item.label} (${item.count} new)` : item.label}
            data-activity-anchor={item.key === "activity" ? "" : undefined}
            className={({ isActive }) => `nav-item ${(item.active ?? isActive) ? "active" : ""}`}
        >
            {body}
        </NavLink>
    );
};

const SideNav = ({ primary, secondary, account, onCreate }) => (
    <aside className="sidenav" aria-label="Main navigation">
        <Brand />
        <nav className="sidenav-main">
            {primary.map((item) => (
                <PrimaryLink key={item.key} item={item} onCreate={onCreate} />
            ))}
            {secondary.length > 0 && <div className="sidenav-divider" />}
            {secondary.map((item) => (
                <NavLink key={item.to} to={item.to} title={item.label} className={({ isActive }) => `nav-item nav-item-sm ${isActive ? "active" : ""}`}>
                    <span className="nav-icon">
                        <item.icon size={20} strokeWidth={1.9} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                </NavLink>
            ))}
        </nav>
        <ActionMenu
            align="left"
            items={account}
            label="More"
            className="sidenav-more"
            trigger={({ open, toggle, menuId }) => (
                <button type="button" className="nav-item" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} title="More">
                    <span className="nav-icon">
                        <Menu size={24} strokeWidth={1.9} />
                    </span>
                    <span className="nav-label">More</span>
                </button>
            )}
        />
    </aside>
);

const TopBar = ({ secondary, account }) => {
    const navigate = useNavigate();
    const items = [...secondary.map((item) => ({ label: item.label, icon: item.icon, onClick: () => navigate(item.to) })), ...(secondary.length ? ["divider"] : []), ...account];
    return (
        <header className="topbar">
            <Brand />
            <ActionMenu
                items={items}
                label="Menu"
                trigger={({ open, toggle, menuId }) => (
                    <button type="button" className="icon-button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label="Menu">
                        <Menu size={24} strokeWidth={1.9} />
                    </button>
                )}
            />
        </header>
    );
};

const TabBar = ({ primary, onCreate }) => (
    <nav className="tabbar" aria-label="Tabs">
        {primary.map((item) => (
            <PrimaryLink key={item.key} item={item} onCreate={onCreate} />
        ))}
    </nav>
);

export const AppShell = () => {
    const location = useLocation();
    const primary = usePrimaryNav();
    const secondary = useSecondaryNav();
    const account = useAccountMenu();
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [location.pathname]);

    return (
        <div className="shell">
            <SideNav primary={primary} secondary={secondary} account={account} onCreate={() => setCreating(true)} />
            <TopBar secondary={secondary} account={account} />
            <main className="content">
                <Outlet />
            </main>
            <TabBar primary={primary} onCreate={() => setCreating(true)} />
            <CreateSheet open={creating} onClose={() => setCreating(false)} />
            <ActivityBubble />
            <PhoneRequired />
        </div>
    );
};
