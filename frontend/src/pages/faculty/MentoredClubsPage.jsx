import { GraduationCap } from "lucide-react";
import { useWorkspace } from "../../context/WorkspaceContext";
import { ClubCard } from "../../components/clubs/ClubCard";
import { EmptyState, PageHeader } from "../../components/ui";

const MentoredClubsPage = () => {
    const { mentoredClubs } = useWorkspace();

    return (
        <>
            <PageHeader
                title="Mentored clubs"
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
