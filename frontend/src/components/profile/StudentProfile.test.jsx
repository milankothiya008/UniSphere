import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { StudentProfile } from "./StudentProfile";

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
    student: {
        stats: { upcoming: 1, attended: 3, clubs: 1, pendingClubs: 0 },
        upcomingRegistrations: [{ _id: "r1", event: event("e1", "HackNight", 72) }],
        pastRegistrations: [{ _id: "r2", hasResults: true, event: event("e0", "CodeSprint", -72, { status: "COMPLETED" }) }],
        recommended: [],
        memberships: [{ _id: "m1", role: "MEMBER", status: "APPROVED", club: { _id: "c1", name: "Coding Club" } }],
        clubWorkspaces: [],
        clubRequests: [],
        applications: [],
        recentNotifications: []
    }
});

const workspace = {
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
};

describe("StudentProfile", () => {
    test("shows a countdown to the next event and does not repeat it in the schedule", () => {
        renderWithRouter(<StudentProfile data={data()} />);

        expect(screen.getByText("Next up")).toBeInTheDocument();
        expect(screen.getByLabelText("Time until the event starts")).toBeInTheDocument();
        expect(screen.getAllByText("HackNight")).toHaveLength(1);
        expect(screen.getByText("Nothing else scheduled")).toBeInTheDocument();
    });

    test("switches the schedule to past events with results", async () => {
        renderWithRouter(<StudentProfile data={data()} />);
        await userEvent.click(screen.getByRole("tab", { name: /past/i }));
        expect(screen.getByText("CodeSprint")).toBeInTheDocument();
        expect(screen.getByText("Results out")).toBeInTheDocument();
    });

    test("lists waitlisted events with their place in line", async () => {
        const withWaitlist = data();
        withWaitlist.student.waitlistedRegistrations = [{ _id: "w1", status: "WAITLISTED", waitlistPosition: 3, event: event("e7", "Sold Out Show", 90) }];
        renderWithRouter(<StudentProfile data={withWaitlist} />);

        await userEvent.click(screen.getByRole("tab", { name: /waitlist/i }));
        expect(screen.getByText("Sold Out Show")).toBeInTheDocument();
        expect(screen.getByText("#3 in line")).toBeInTheDocument();
    });

    test("officers open on Club HQ, and the Clubs tab leaves out the clubs they run", async () => {
        const officer = data();
        officer.student.memberships = [
            { _id: "m1", role: "PRESIDENT", status: "APPROVED", club: { _id: "c1", name: "Coding Club" } },
            { _id: "m2", role: "MEMBER", status: "APPROVED", club: { _id: "c9", name: "Music Society" } }
        ];
        officer.student.clubWorkspaces = [workspace];
        renderWithRouter(<StudentProfile data={officer} />);

        expect(screen.getByRole("tab", { name: /club hq/i })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("heading", { name: "Coding Club" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("tab", { name: /^clubs$/i }));
        const otherClubs = screen.getByText("Other clubs").closest(".card");
        expect(within(otherClubs).getByText("Music Society")).toBeInTheDocument();
        expect(within(otherClubs).queryByText("Coding Club")).not.toBeInTheDocument();
    });
});
