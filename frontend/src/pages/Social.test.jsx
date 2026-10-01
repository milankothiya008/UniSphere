import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "react-router-dom";
import { renderWithRouter, authValue } from "../test/renderWithProviders";
import NotificationsPage from "./NotificationsPage";
import PersonPage from "./PersonPage";
import { EventPost } from "../components/events/EventPost";
import { ActivityBubble } from "../components/layout/ActivityBubble";
import { useAuth } from "../context/AuthContext";
import { clubApi, notificationApi, userApi } from "../api/endpoints";
import { refreshUnread } from "../hooks/useUnreadCount";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../api/endpoints", () => ({
    notificationApi: { list: vi.fn(), markAllRead: vi.fn(), unreadCount: vi.fn() },
    recruitmentApi: { mine: vi.fn(() => Promise.resolve({ data: [] })) },
    clubApi: { setSubscription: vi.fn() },
    userApi: { profile: vi.fn() },
    eventApi: { register: vi.fn() }
}));

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const unread = (count, kinds = { events: count, clubs: 0, recruitment: 0 }) => ({ data: { count, kinds } });

beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue(authValue());
    notificationApi.unreadCount.mockResolvedValue(unread(0));
    notificationApi.markAllRead.mockResolvedValue({ data: { updated: 2 } });
    try {
        sessionStorage.clear();
    } catch {
        // ignore
    }
});

describe("Activity", () => {
    test("opening it marks everything as seen and lists the unseen ones under New", async () => {
        notificationApi.list.mockResolvedValue({
            data: [
                { _id: "n1", type: "EVENT_PUBLISHED", title: "HackNight is live", createdAt: ago(5), readAt: null },
                { _id: "n2", type: "ANNOUNCEMENT", title: "Club news", createdAt: ago(30), readAt: null },
                { _id: "n3", type: "EVENT_UPDATED", title: "Venue changed", createdAt: ago(60), readAt: ago(40) }
            ],
            meta: { unread: 2, page: 1, totalPages: 1 }
        });
        renderWithRouter(<NotificationsPage />);

        const fresh = (await screen.findByRole("heading", { name: "New" }, { timeout: 4000 })).closest("section");
        expect(within(fresh).getByText(/HackNight is live/)).toBeInTheDocument();
        expect(within(fresh).getByText(/Club news/)).toBeInTheDocument();
        expect(within(fresh).queryByText(/Venue changed/)).not.toBeInTheDocument();
        await waitFor(() => expect(notificationApi.markAllRead).toHaveBeenCalledTimes(1), { timeout: 4000 });
        expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
    });
});

describe("Activity bubble", () => {
    test("pops out of the heart with counts per kind when something new arrives, and opens Activity", async () => {
        renderWithRouter(
            <>
                <a href="/activity" data-activity-anchor="">
                    <span className="nav-icon">♥</span>
                </a>
                <ActivityBubble />
            </>,
            { route: "/feed", extraRoutes: <Route path="/activity" element={<p>Activity page</p>} /> }
        );
        expect(screen.queryByRole("button", { name: /New activity/ })).not.toBeInTheDocument();

        notificationApi.unreadCount.mockResolvedValue(unread(4, { events: 2, clubs: 1, recruitment: 1 }));
        await act(() => refreshUnread());
        const bubble = await screen.findByRole("button", { name: "New activity: 2 event updates, 1 club updates, 1 recruitment updates. Open Activity" });
        await userEvent.click(bubble);
        expect(await screen.findByText("Activity page")).toBeInTheDocument();
    });
});

describe("Follow from the feed", () => {
    const event = {
        _id: "e1",
        title: "HackNight 2026",
        shortDescription: "Build something.",
        category: "COMPETITION",
        status: "PUBLISHED",
        registrationState: "OPEN",
        registeredCount: 0,
        maxParticipants: 50,
        startAt: new Date(Date.now() + 86400000).toISOString(),
        endAt: new Date(Date.now() + 90000000).toISOString(),
        publishedAt: ago(10),
        eligibility: { departments: [], batches: [] },
        venue: { name: "Auditorium" },
        myRegistration: null
    };

    test("posts from clubs you don't follow offer Follow; following hides it on every post of that club", async () => {
        clubApi.setSubscription.mockResolvedValue({ data: { subscribed: true, emailsEnabled: true } });
        renderWithRouter(
            <>
                <EventPost event={{ ...event, club: { _id: "c9", name: "Drama Club" }, followingClub: false }} />
                <EventPost event={{ ...event, _id: "e2", club: { _id: "c9", name: "Drama Club" }, followingClub: false }} />
                <EventPost event={{ ...event, _id: "e3", club: { _id: "c1", name: "Coding Club" }, followingClub: true }} />
            </>
        );
        const buttons = screen.getAllByRole("button", { name: "Follow Drama Club" });
        expect(buttons).toHaveLength(2);
        expect(screen.queryByRole("button", { name: "Follow Coding Club" })).not.toBeInTheDocument();

        await userEvent.click(buttons[0]);
        await waitFor(() => expect(clubApi.setSubscription).toHaveBeenCalledWith("c9", true));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Follow Drama Club" })).not.toBeInTheDocument());
    });
});

describe("Someone's profile", () => {
    test("shows who they are and their clubs, and says contact details and schedule are private", async () => {
        userApi.profile.mockResolvedValue({
            data: {
                _id: "u7",
                name: "Meera Iyer",
                globalRole: "STUDENT",
                accountType: "STUDENT",
                departmentCode: "IT",
                batchCode: "25",
                isSelf: false,
                clubs: [{ club: { _id: "c1", name: "Coding Club", category: "TECHNOLOGY" }, role: "VICE_PRESIDENT", roleName: "Vice-president" }],
                mentoredClubs: []
            }
        });
        renderWithRouter(<PersonPage />, { route: "/people/u7", path: "/people/:id" });

        expect(await screen.findByRole("heading", { name: "Meera Iyer" })).toBeInTheDocument();
        expect(screen.getByText("Contact details and event schedule are private")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Coding Club/ })).toHaveAttribute("href", "/clubs/c1");
        expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    });

    test("your own id goes to your full profile", async () => {
        userApi.profile.mockResolvedValue({ data: { _id: "u1", name: "Asha", isSelf: true, clubs: [], mentoredClubs: [] } });
        renderWithRouter(<PersonPage />, { route: "/people/u1", path: "/people/:id", extraRoutes: <Route path="/profile" element={<p>My profile</p>} /> });
        expect(await screen.findByText("My profile")).toBeInTheDocument();
    });
});
