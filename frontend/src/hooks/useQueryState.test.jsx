import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/renderWithProviders";
import { useQueryState } from "./useQueryState";

const Probe = () => {
    const [filters, setFilters] = useQueryState({ tab: "upcoming", category: "" });
    return (
        <>
            <p>
                tab={filters.tab} category={filters.category || "-"}
            </p>
            <button
                type="button"
                onClick={() => {
                    // Two changes before the next render: both must survive.
                    setFilters({ tab: "past" });
                    setFilters({ category: "MUSIC" });
                }}
            >
                both
            </button>
        </>
    );
};

describe("useQueryState", () => {
    test("keeps every change made before the URL catches up", async () => {
        renderWithRouter(<Probe />, { route: "/feed", path: "/feed" });
        expect(screen.getByText("tab=upcoming category=-")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "both" }));
        expect(screen.getByText("tab=past category=MUSIC")).toBeInTheDocument();
    });
});
