import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { ClubInsights } from "./ClubInsights";

const insights = {
    totalMembers: 42,
    totalEvents: 5,
    eventsInPipeline: 2,
    totalRegistrations: 180,
    upcomingEvents: 2,
    completedEvents: 3,
    averageParticipation: 36,
    seatFillRate: 81,
    waitlisted: 7,
    eventWise: [
        { _id: "e1", title: "HackNight 2026", startAt: "2026-10-06T12:30:00.000Z", status: "PUBLISHED", upcoming: true, registered: 60, capacity: 60, waitlist: 7 },
        { _id: "e2", title: "CodeSprint", startAt: "2026-09-17T04:30:00.000Z", status: "COMPLETED", upcoming: false, registered: 32, capacity: 50, waitlist: 0 },
        { _id: "e3", title: "Open Talk", startAt: "2026-09-01T10:00:00.000Z", status: "COMPLETED", upcoming: false, registered: 88, capacity: null, waitlist: 0 }
    ]
};

describe("ClubInsights", () => {
    test("shows the club's headline numbers", () => {
        renderWithRouter(<ClubInsights insights={insights} clubId="c1" />);
        const tile = (label) => screen.getByText(label).closest(".stat");

        expect(within(tile("Total members")).getByText("42")).toBeInTheDocument();
        expect(within(tile("Total events")).getByText("+2 in the pipeline")).toBeInTheDocument();
        expect(within(tile("Total registrations")).getByText("+7 on waitlists")).toBeInTheDocument();
        expect(within(tile("Upcoming events")).getByText("2")).toBeInTheDocument();
        expect(within(tile("Completed events")).getByText("3")).toBeInTheDocument();
        expect(within(tile("Average participation")).getByText("per event · 81% of seats filled")).toBeInTheDocument();
    });

    test("charts registrations per event with capacity, waitlist and a tooltip", async () => {
        renderWithRouter(<ClubInsights insights={insights} clubId="c1" />);

        const hack = screen.getByRole("link", { name: "HackNight 2026: 60 registered of 60, 7 on the waitlist" });
        expect(hack).toHaveAttribute("href", "/events/e1/participants");
        expect(within(hack).getByText("+7 waiting")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Open Talk: 88 registered" })).toBeInTheDocument();

        await userEvent.hover(screen.getByRole("link", { name: /CodeSprint/ }));
        const tooltip = screen.getByRole("tooltip");
        expect(within(tooltip).getByText("32 registrations of 50 seats (64%)")).toBeInTheDocument();
        expect(within(tooltip).getByText(/Completed/)).toBeInTheDocument();
    });

    test("offers the same data as a table", async () => {
        renderWithRouter(<ClubInsights insights={insights} clubId="c1" />);
        await userEvent.click(screen.getByRole("button", { name: /table/i }));

        const rows = within(screen.getByRole("table")).getAllByRole("row");
        expect(rows).toHaveLength(4);
        expect(within(rows[1]).getByText("100%")).toBeInTheDocument();
        expect(within(rows[3]).getAllByText("—").length).toBeGreaterThan(0);
    });

    test("explains an empty chart", () => {
        renderWithRouter(<ClubInsights insights={{ ...insights, totalEvents: 0, eventWise: [] }} clubId="c1" />);
        expect(screen.getByText(/appear here once your first event is published/)).toBeInTheDocument();
    });
});
