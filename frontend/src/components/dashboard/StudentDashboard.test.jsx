import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { StudentDashboard } from "./StudentDashboard";
import { eventApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({ eventApi: { register: vi.fn() }, notificationApi: { markRead: vi.fn() } }));

const inHours = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const event = (id, title, startHours, extra = {}) => ({
    _id: id,
    title,
    category: "WORKSHOP",
    status: "PUBLISHED",
    startAt: inHours(startHours),
    endAt: inHours(startHours + 2),
    registrationEnd: inHours(startHours - 1),
    registeredCount: 10,
    maxParticipants: 50,
    club: { _id: "c1", name: "Coding Club" },
    venue: { name: "Auditorium" },
    ...extra
});

const data = () => ({
    unreadNotifications: 2,
    student: {
        stats: { upcoming: 1, attended: 3, clubs: 1, pendingClubs: 0 },
        upcomingRegistrations: [{ _id: "r1", event: event("e1", "HackNight", 72) }],
        pastRegistrations: [{ _id: "r2", hasResults: true, event: event("e0", "CodeSprint", -72, { status: "COMPLETED" }) }],
        recommended: [event("e2", "Git Workshop", 200, { fromMyClub: true }), event("e3", "Quiz Night", 30)],
        memberships: [{ _id: "m1", role: "MEMBER", status: "APPROVED", club: { _id: "c1", name: "Coding Club" } }],
        clubWorkspaces: [],
        clubRequests: [],
        recentNotifications: [{ _id: "n1", title: "New event: Quiz Night", createdAt: inHours(-1), readAt: null, link: "/events/e3" }]
    }
});

const titlesIn = (container) => within(container).queryAllByText(/HackNight|Git Workshop|Quiz Night|CodeSprint/).map((node) => node.textContent);

describe("StudentDashboard", () => {
    test("does not repeat clubs the student already runs in Club HQ, nor show separate club or unread tiles", () => {
        const withWorkspace = data();
        withWorkspace.student.memberships = [
            { _id: "m1", role: "PRESIDENT", status: "APPROVED", club: { _id: "c1", name: "Coding Club" } },
            { _id: "m2", role: "MEMBER", status: "APPROVED", club: { _id: "c9", name: "Music Society" } }
        ];
        withWorkspace.student.clubWorkspaces = [
            {
                club: { _id: "c1", name: "Coding Club", category: "TECHNOLOGY" },
                role: "PRESIDENT",
                permissions: ["MANAGE_CLUB", "MANAGE_EVENTS"],
                memberCount: 4,
                pendingMembershipRequests: 0,
                drafts: [],
                needsChanges: [],
                pendingApproval: [],
                readyToPublish: [],
                upcoming: [],
                awaitingCompletion: [],
                resultsPending: [],
                insights: null
            }
        ];
        renderWithRouter(<StudentDashboard user={authValue().user} data={withWorkspace} />);

        expect(screen.getByRole("heading", { name: "Coding Club" })).toBeInTheDocument();
        const otherClubs = screen.getByText("Other clubs").closest(".card");
        expect(within(otherClubs).getByText("Music Society")).toBeInTheDocument();
        expect(within(otherClubs).queryByText("Coding Club")).not.toBeInTheDocument();
        expect(screen.queryByText(/unread/i)).not.toBeInTheDocument();
    });

    test("lists waitlisted events with their place in line", async () => {
        const withWaitlist = data();
        withWaitlist.student.waitlistedRegistrations = [{ _id: "w1", status: "WAITLISTED", waitlistPosition: 3, event: event("e7", "Sold Out Show", 90) }];
        renderWithRouter(<StudentDashboard user={authValue().user} data={withWaitlist} />);

        expect(within(screen.getByText("on waitlist").closest("a")).getByText("1")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("tab", { name: /waitlist/i }));
        expect(screen.getByText("Sold Out Show")).toBeInTheDocument();
        expect(screen.getByText("#3 in line")).toBeInTheDocument();
    });

    test("shows a countdown to the next event, stats, schedule and recommendations without repeating events", () => {
        renderWithRouter(<StudentDashboard user={authValue().user} data={data()} />);

        expect(screen.getByText("Next up")).toBeInTheDocument();
        expect(screen.getByLabelText("Time until the event starts")).toBeInTheDocument();
        expect(screen.getByText("attended").closest("a")).toHaveAttribute("href", "/my-registrations?timeframe=past");
        expect(screen.getByText("Your club")).toBeInTheDocument();
        expect(screen.getByText(/Closes in/)).toBeInTheDocument();

        // The pinned next event (HackNight) is not repeated in the schedule list.
        const titles = titlesIn(document.querySelector(".stack-lg"));
        expect(new Set(titles).size).toBe(titles.length);
        expect(screen.getByText("Nothing else scheduled")).toBeInTheDocument();
    });

    test("switches the schedule to past events with results", async () => {
        renderWithRouter(<StudentDashboard user={authValue().user} data={data()} />);
        await userEvent.click(screen.getByRole("tab", { name: /past/i }));
        expect(screen.getByText("CodeSprint")).toBeInTheDocument();
        expect(screen.getByText("Results out")).toBeInTheDocument();
    });

    test("registering from a recommendation moves the event into the schedule", async () => {
        eventApi.register.mockResolvedValue({ data: { registeredCount: 11 } });
        renderWithRouter(<StudentDashboard user={authValue().user} data={data()} />);

        const card = screen.getByText("Quiz Night").closest("article");
        await userEvent.click(within(card).getByRole("button", { name: /register/i }));

        expect(eventApi.register).toHaveBeenCalledWith("e3");
        expect(within(screen.getByText("upcoming").closest("a")).getByText("2")).toBeInTheDocument();
        expect(screen.queryAllByRole("article").map((a) => a.textContent).join()).not.toMatch(/Quiz Night/);
        // Quiz Night starts sooner than HackNight, so it becomes the pinned next event and HackNight moves to the list.
        expect(document.querySelector(".next-up strong").textContent).toBe("Quiz Night");
        const everywhere = titlesIn(document.querySelector(".stack-lg"));
        expect(everywhere.filter((t) => t === "Quiz Night")).toHaveLength(1);
        expect(everywhere.filter((t) => t === "HackNight")).toHaveLength(1);
    });
});
