import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, ChevronRight, CircleDashed, Lightbulb, Megaphone, UserPlus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { Modal } from "../ui";
import { PERMISSIONS } from "../../lib/constants";
import { PostComposer } from "../feed/PostComposer";
import { StoryComposer } from "../stories/StoryComposer";

// What the signed-in user can create. An empty list hides the Create button entirely.
export const useCreateOptions = () => {
    const { isStudent } = useAuth();
    const { eventClubs, postingClubs, approvedMemberships } = useWorkspace();
    const recruiting = approvedMemberships.filter((m) => m.club?.status === "ACTIVE" && m.permissions?.includes(PERMISSIONS.MANAGE_RECRUITMENT));

    return [
        eventClubs.length > 0 && { key: "event", icon: CalendarPlus, label: "Event", to: "/events/create" },
        postingClubs.length > 0 && { key: "story", icon: CircleDashed, label: "Story" },
        postingClubs.length > 0 && { key: "post", icon: Megaphone, label: "Announcement" },
        ...recruiting.map((m) => ({
            key: `drive-${m.club._id}`,
            icon: UserPlus,
            label: recruiting.length > 1 ? `Recruitment · ${m.club.name}` : "Recruitment",
            to: `/clubs/${m.club._id}/recruitment`
        })),
        isStudent && { key: "club", icon: Lightbulb, label: "Propose a club", to: "/club-requests/new" }
    ].filter(Boolean);
};

export const CreateSheet = ({ open, onClose }) => {
    const navigate = useNavigate();
    const options = useCreateOptions();
    const { postingClubs } = useWorkspace();
    const [composer, setComposer] = useState(null);
    const clubs = postingClubs.map((m) => m.club).filter(Boolean);

    const pick = (option) => {
        onClose();
        if (option.to) {
            navigate(option.to);
        } else {
            setComposer(option.key);
        }
    };

    return (
        <>
            <Modal open={open} onClose={onClose} title="Create">
                <div className="create-list">
                    {options.map((option) => (
                        <button key={option.key} type="button" className="create-option" onClick={() => pick(option)}>
                            <option.icon size={22} />
                            <span className="grow">{option.label}</span>
                            <ChevronRight size={18} className="subtle" />
                        </button>
                    ))}
                </div>
            </Modal>
            {clubs.length > 0 && <StoryComposer open={composer === "story"} onClose={() => setComposer(null)} clubs={clubs} />}
            <Modal open={composer === "post"} onClose={() => setComposer(null)} title="New announcement" size="lg">
                <PostComposer clubs={postingClubs} onPosted={() => setComposer(null)} />
            </Modal>
        </>
    );
};
