import { useOutletContext } from "react-router-dom";
import { CalendarDays, Crown, GraduationCap, Newspaper } from "lucide-react";
import { feedApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { FeedCard } from "../../components/feed/FeedCard";
import { PostComposer } from "../../components/feed/PostComposer";
import { ClubConnectCard } from "../../components/clubs/ClubConnect";
import { AsyncContent, Avatar, Card, EmptyState } from "../../components/ui";
import { PERMISSIONS } from "../../lib/constants";
import { formatDate } from "../../lib/format";

const ClubAboutTab = () => {
    const { club } = useOutletContext();
    const toast = useToast();
    const viewer = club.viewer || {};
    const can = (permission) => viewer.permissions?.includes(permission);
    // Club announcements (members-only ones are returned only to members and the mentor).
    const posts = useApi(() => feedApi.list({ club: club._id, types: "ANNOUNCEMENT,CLUB_UPDATE", limit: 10 }), [club._id]);

    const remove = async (post) => {
        await feedApi.remove(post._id);
        toast.success("Post deleted");
        posts.reload({ silent: true });
    };

    return (
        <div className="detail-layout">
            <div className="stack-lg">
                <Card title="About">
                    <div className="stack">
                        <p className="prose">{club.description}</p>
                        {club.purpose && (
                            <div>
                                <div className="section-title">Purpose</div>
                                <p className="prose">{club.purpose}</p>
                            </div>
                        )}
                    </div>
                </Card>

                {can(PERMISSIONS.POST_UPDATES) && club.status === "ACTIVE" && (
                    <Card title="Send an announcement">
                        <PostComposer clubs={[{ club }]} fixedClubId={club._id} onPosted={() => posts.reload({ silent: true })} />
                    </Card>
                )}

                <div className="stack">
                    <h2 className="row">
                        <Newspaper size={18} /> Announcements
                    </h2>
                    <AsyncContent
                        loading={posts.loading}
                        error={posts.error}
                        onRetry={posts.reload}
                        isEmpty={!posts.data?.length}
                        empty={
                            <Card>
                                <EmptyState icon={Newspaper} title="No announcements yet" description="Announcements from this club appear here, and everyone is notified when one is sent." />
                            </Card>
                        }
                    >
                        {posts.data?.map((post) => (
                            <FeedCard key={post._id} post={post} canDelete={can(PERMISSIONS.MANAGE_CLUB)} onDelete={remove} />
                        ))}
                    </AsyncContent>
                </div>
            </div>

            <aside className="stack">
                <Card title="People">
                    <div className="stack">
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                            <Avatar name={club.president?.name || "?"} src={club.president?.avatar} />
                            <div>
                                <span className="subtle row" style={{ gap: 5 }}>
                                    <Crown size={12} /> President
                                </span>
                                <strong>{club.president?.name || "Not appointed yet"}</strong>
                            </div>
                        </div>
                        <div className="row" style={{ flexWrap: "nowrap" }}>
                            <Avatar name={club.mentor?.name || "?"} src={club.mentor?.avatar} />
                            <div>
                                <span className="subtle row" style={{ gap: 5 }}>
                                    <GraduationCap size={12} /> Faculty mentor
                                </span>
                                <strong>{club.mentor?.name || "Not assigned"}</strong>
                            </div>
                        </div>
                    </div>
                </Card>
                <ClubConnectCard club={club} />
                <Card>
                    <dl className="meta-list">
                        <div>
                            <CalendarDays size={16} />
                            <span>
                                <dt>Founded on CampusConnect</dt>
                                <dd>{formatDate(club.createdAt)}</dd>
                            </span>
                        </div>
                    </dl>
                </Card>
            </aside>
        </div>
    );
};

export default ClubAboutTab;
