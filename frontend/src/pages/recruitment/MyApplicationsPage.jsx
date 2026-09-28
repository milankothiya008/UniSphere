import { Link } from "react-router-dom";
import { ChevronRight, FileSignature, Megaphone } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { AsyncContent, Avatar, ButtonLink, Card, EmptyState, PageHeader } from "../../components/ui";
import { Deadline, PhaseBadge } from "../../components/recruitment/RecruitmentParts";
import { ApplicationRow } from "../../components/recruitment/ApplicationRow";

/** Recruitment open to the student right now, and their applications. */
const MyApplicationsPage = () => {
    const mine = useApi(() => recruitmentApi.mine(), []);
    const open = useApi(() => recruitmentApi.open(), []);
    const appliedTo = new Set((mine.data || []).map((application) => String(application.drive._id)));
    const available = (open.data || []).filter((drive) => drive.eligible && !appliedTo.has(String(drive._id)));

    return (
        <>
            <PageHeader
                eyebrow={
                    <>
                        <FileSignature size={14} /> Recruitment
                    </>
                }
                title="My applications"
                description="Club recruitment you've applied to, your interviews and results — plus clubs recruiting right now."
            />
            <div className="stack-lg">
                {available.length > 0 && (
                    <Card title={<h2 className="row"><Megaphone size={18} /> Recruiting now</h2>} padded={false}>
                        <ul className="recruit-open-list">
                            {available.map((drive) => (
                                <li key={drive._id}>
                                    <Link to={`/recruitment/${drive._id}`} className="recruit-my-row">
                                        <Avatar name={drive.club.name} src={drive.club.logo} size="md" square />
                                        <span className="grow">
                                            <strong>{drive.title}</strong>
                                            <span className="subtle small">
                                                {drive.club.name} · {drive.positions.join(", ")}
                                            </span>
                                        </span>
                                        {drive.phase === "OPEN" ? <Deadline drive={drive} /> : <PhaseBadge phase={drive.phase} />}
                                        <ChevronRight size={16} className="subtle" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}
                <AsyncContent
                    loading={mine.loading}
                    error={mine.error}
                    onRetry={mine.reload}
                    isEmpty={!mine.data?.length}
                    empty={
                        <Card>
                            <EmptyState
                                icon={FileSignature}
                                title="No applications yet"
                                description="When a club you can join opens recruitment, you'll get a notification and an email. Apply from the club's page."
                                action={
                                    <ButtonLink to="/clubs" variant="secondary">
                                        Browse clubs
                                    </ButtonLink>
                                }
                            />
                        </Card>
                    }
                >
                    <Card title="Your applications" padded={false}>
                        <ul className="recruit-open-list">
                            {mine.data?.map((application) => (
                                <li key={application._id}>
                                    <ApplicationRow application={application} />
                                </li>
                            ))}
                        </ul>
                    </Card>
                </AsyncContent>
            </div>
        </>
    );
};

export default MyApplicationsPage;
