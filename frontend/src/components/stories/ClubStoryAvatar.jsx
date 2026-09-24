import { useState } from "react";
import { useStories } from "../../hooks/useStories";
import { Avatar } from "../ui";
import { StoryViewer } from "./StoryViewer";

// A club's logo that shows a story ring, and plays the club's stories when tapped, while it has live ones.
export const ClubStoryAvatar = ({ club, size = "lg", square = false }) => {
    const { groups } = useStories();
    const [watching, setWatching] = useState(false);
    const group = groups?.find((item) => String(item.club._id) === String(club._id));

    if (!group) {
        return <Avatar name={club.name} src={club.logo} size={size} square={square} />;
    }

    return (
        <>
            <button type="button" className={`club-story-avatar ${group.allSeen ? "is-seen" : ""}`} onClick={() => setWatching(true)} aria-label={`Watch ${club.name}'s story`}>
                <Avatar name={club.name} src={club.logo} size={size} />
            </button>
            {watching && <StoryViewer groups={[group]} startClubId={String(club._id)} onClose={() => setWatching(false)} />}
        </>
    );
};
