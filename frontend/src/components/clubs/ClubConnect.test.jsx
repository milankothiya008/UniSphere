import { render, screen, within } from "@testing-library/react";
import { ClubConnectCard, ClubSocialRow } from "./ClubConnect";
import { linkProblem } from "../../lib/clubLinks";

const club = {
    name: "Robotics Club",
    website: "https://roboticsclub.ddu.ac.in/",
    contactEmail: "robotics@ddu.ac.in",
    contactPhone: "+91 98765 43210",
    meetingSchedule: "Every Friday, 4:00–5:30 PM",
    meetingLocation: "Lab 204, CE Block",
    socialLinks: { instagram: "https://www.instagram.com/ddu.robotics", github: "https://github.com/ddu-robotics", youtube: null }
};

describe("club links", () => {
    test("the header row shows the website and only the platforms the club uses", () => {
        render(<ClubSocialRow club={club} />);
        expect(screen.getByRole("link", { name: /website/i })).toHaveAttribute("href", club.website);
        const instagram = screen.getByRole("link", { name: "Robotics Club on Instagram" });
        expect(instagram).toHaveAttribute("href", "https://www.instagram.com/ddu.robotics");
        expect(instagram).toHaveAttribute("rel", "noopener noreferrer");
        expect(instagram).toHaveAttribute("target", "_blank");
        expect(screen.getByRole("link", { name: "Robotics Club on GitHub" })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /YouTube/ })).not.toBeInTheDocument();
    });

    test("the Connect card lists contact, meetings and followable profiles", () => {
        render(<ClubConnectCard club={club} />);
        expect(screen.getByRole("link", { name: /roboticsclub\.ddu\.ac\.in/ })).toHaveAttribute("href", club.website);
        expect(screen.getByRole("link", { name: "robotics@ddu.ac.in" })).toHaveAttribute("href", "mailto:robotics@ddu.ac.in");
        expect(screen.getByRole("link", { name: "+91 98765 43210" })).toHaveAttribute("href", "tel:+919876543210");
        expect(screen.getByText("Every Friday, 4:00–5:30 PM")).toBeInTheDocument();
        expect(screen.getByText("Lab 204, CE Block")).toBeInTheDocument();
        const instagram = screen.getByRole("link", { name: /Instagram/ });
        expect(within(instagram).getByText("instagram.com/ddu.robotics")).toBeInTheDocument();
    });

    test("nothing is rendered for a club without any links", () => {
        const { container } = render(
            <>
                <ClubSocialRow club={{ name: "Quiet Club", socialLinks: {} }} />
                <ClubConnectCard club={{ name: "Quiet Club", socialLinks: {} }} />
            </>
        );
        expect(container).toBeEmptyDOMElement();
    });

    test("link checks match the server's rules", () => {
        expect(linkProblem("", { label: "Website" })).toBeNull();
        expect(linkProblem("roboticsclub.ddu.ac.in", { label: "Website" })).toBeNull();
        expect(linkProblem("javascript:alert(1)", { label: "Website" })).toBe("Website must be a valid web address");
        expect(linkProblem("https://m.youtube.com/@club", { label: "YouTube", hosts: ["youtube.com", "youtu.be"] })).toBeNull();
        expect(linkProblem("https://evil.com/instagram.com", { label: "Instagram", hosts: ["instagram.com"] })).toBe("Instagram link must be on instagram.com");
    });
});
