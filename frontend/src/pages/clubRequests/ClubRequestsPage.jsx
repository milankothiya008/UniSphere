import { Link } from "react-router-dom";
import { FileText, Lightbulb } from "lucide-react";
import { clubRequestApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useAuth } from "../../context/AuthContext";
import { AsyncContent, Avatar, ButtonLink, Card, EmptyState, PageHeader, Pagination, StatusBadge, Tabs } from "../../components/ui";
import { departmentsLabel, humanize, timeAgo } from "../../lib/format";

const TABS = {
    STUDENT: [
        { value: "ALL", label: "All my requests" },
        { value: "NEEDS_CHANGES", label: "Changes requested" },
        { value: "PENDING_FACULTY_REVIEW", label: "In faculty review" },
        { value: "FACULTY_VERIFIED", label: "Awaiting admin" },
        { value: "APPROVED", label: "Approved" },
        { value: "REJECTED", label: "Rejected" }
    ],
    FACULTY: [
        { value: "PENDING_FACULTY_REVIEW", label: "To review" },
        { value: "FACULTY_VERIFIED", label: "Verified by me" },
        { value: "ALL", label: "All" }
    ],
    ADMIN: [
        { value: "FACULTY_VERIFIED", label: "Awaiting approval" },
        { value: "PENDING_FACULTY_REVIEW", label: "In faculty review" },
        { value: "NEEDS_CHANGES", label: "Changes requested" },
        { value: "APPROVED", label: "Approved" },
        { value: "REJECTED", label: "Rejected" },
        { value: "ALL", label: "All" }
    ]
};

const ClubRequestsPage = ({ adminView = false }) => {
    const { user, isStudent, isFaculty } = useAuth();
    const tabs = TABS[user.globalRole];
    const [filters, setFilters] = useQueryState({ status: tabs[0].value, page: "1" });

    const { data, meta, loading, error, reload } = useApi(
        () => clubRequestApi.list({ status: filters.status === "ALL" ? undefined : filters.status, page: filters.page, limit: 20 }),
        [filters.status, filters.page]
    );

    return (
        <>
            <PageHeader
                title={adminView ? "Club approvals" : isFaculty ? "Club requests to review" : "Your club requests"}
                actions={
                    isStudent && (
                        <ButtonLink to="/club-requests/new">
                            <Lightbulb size={16} /> Propose a club
                        </ButtonLink>
                    )
                }
            />
            <div className="stack">
                <Tabs tabs={tabs} value={filters.status} onChange={(status) => setFilters({ status })} />
                <Card padded={false}>
                    <AsyncContent
                        loading={loading}
                        error={error}
                        onRetry={reload}
                        isEmpty={!data?.length}
                        empty={
                            <EmptyState
                                icon={FileText}
                                title="No requests here"
                                description={isStudent ? "Have an idea for a club? Propose it and gather your founding members." : "Nothing is waiting for you right now."}
                            />
                        }
                    >
                        <div className="list-rows">
                            {data?.map((request) => (
                                <Link key={request._id} to={`/club-requests/${request._id}`} className="list-row">
                                    <Avatar name={request.name} square />
                                    <div className="grow">
                                        <div className="title">{request.name}</div>
                                        <div className="subtle">
                                            {humanize(request.category)} · {departmentsLabel(request)} · by {request.requester?.name}
                                            {request.foundingMembers?.length ? ` + ${request.foundingMembers.length} founders` : ""} · updated {timeAgo(request.updatedAt)}
                                        </div>
                                    </div>
                                    <StatusBadge status={request.status} />
                                </Link>
                            ))}
                        </div>
                    </AsyncContent>
                </Card>
                <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
            </div>
        </>
    );
};

export default ClubRequestsPage;
