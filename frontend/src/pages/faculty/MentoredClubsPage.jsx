import { GraduationCap } from "lucide-react";
import { useWorkspace } from "../../context/WorkspaceContext";
import { ClubCard } from "../../components/clubs/ClubCard";
import { EmptyState, PageHeader } from "../../components/ui";

const MentoredClubsPage = () => {
    const { mentoredClubs } = useWorkspace();

    return (
        <>
            <PageHeader
                eyebrow={<><GraduationCap size={14} /> Faculty</>}
                title="Mentored clubs"
                description="Clubs you oversee as faculty mentor. You approve their events and appoint their president."
            />
            {mentoredClubs.length === 0 ? (
                <EmptyState
                    icon={GraduationCap}
                    title="You don't mentor any clubs yet"
                    description="When you verify a club request and the admin approves it, you become that club's mentor."
                />
            ) : (
                <div className="grid-cards">
                    {mentoredClubs.map((club) => (
                        <ClubCard key={club._id} club={club} showStatus />
                    ))}
                </div>
            )}
        </>
    );
};

export default MentoredClubsPage;
