import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, LayoutGrid, Plus } from "lucide-react";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useStories } from "../../hooks/useStories";
import { Avatar } from "../ui";
import { StoryComposer } from "./StoryComposer";
import { StoryViewer } from "./StoryViewer";

const Skeletons = () =>
    Array.from({ length: 7 }, (_, i) => (
        <span key={i} className="story">
            <span className="story-ring is-loading" />
            <span className="story-name skeleton" style={{ width: 52, height: 10 }} />
        </span>
    ));

/**
 * Instagram-style story rail. Club officers get "Your story" first (tap to watch, + to add); clubs with live
 * stories follow with a coloured ring (grey once watched); other clubs come last as shortcuts to their pages.
 */
export const StoryTray = ({ clubs }) => {
    const { groups } = useStories();
    const { postingClubs } = useWorkspace();
    const rail = useRef(null);
    const [edges, setEdges] = useState({ start: false, end: false });
    const [watching, setWatching] = useState(null);
    const [composing, setComposing] = useState(false);

    const postable = postingClubs.map((membership) => membership.club).filter(Boolean);
    const own = postable[0] || null;
    const ownGroup = own && groups?.find((group) => String(group.club._id) === String(own._id));
    const rings = (groups || []).filter((group) => group !== ownGroup);
    const playable = [ownGroup, ...rings].filter(Boolean);
    const withStories = new Set((groups || []).map((group) => String(group.club._id)));
    const quiet = (clubs || []).filter((club) => !withStories.has(String(club._id)));
    const loading = !groups && !clubs;

    const update = useCallback(() => {
        const node = rail.current;
        if (node) {
            setEdges({ start: node.scrollLeft > 4, end: node.scrollLeft + node.clientWidth < node.scrollWidth - 4 });
        }
    }, []);

    useEffect(() => {
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [update, groups, clubs]);

    const scroll = (direction) => rail.current?.scrollBy({ left: direction * 280, behavior: "smooth" });

    if (!loading && !own && playable.length === 0 && quiet.length === 0) {
        return null;
    }

    let position = 0;
    const order = () => ({ "--i": position++ });

    return (
        <>
            <div className={`stories ${edges.start ? "fade-start" : ""} ${edges.end ? "fade-end" : ""}`}>
                {edges.start && (
                    <button type="button" className="stories-arrow left" onClick={() => scroll(-1)} aria-label="Scroll stories left">
                        <ChevronLeft size={18} />
                    </button>
                )}
                <div className="stories-rail" ref={rail} onScroll={update} aria-label="Club stories">
                    {loading ? (
                        <Skeletons />
                    ) : (
                        <>
                            {own && (
                                <div className="story story-own" style={order()}>
                                    <button
                                        type="button"
                                        className="story-open"
                                        onClick={() => (ownGroup ? setWatching(String(own._id)) : setComposing(true))}
                                        aria-label={ownGroup ? `Watch ${own.name}'s story` : `Add a story for ${own.name}`}
                                    >
                                        <span className={`story-ring ${ownGroup ? (ownGroup.allSeen ? "is-seen" : "") : "is-empty"}`}>
                                            <Avatar name={own.name} src={own.logo} size="lg" />
                                        </span>
                                    </button>
                                    <button type="button" className="story-add" onClick={() => setComposing(true)} aria-label="Add to story" title="Add to story">
                                        <Plus size={14} strokeWidth={3} />
                                    </button>
                                    <span className="story-name">{ownGroup ? "Your story" : "Add story"}</span>
                                </div>
                            )}

                            {rings.map((group) => (
                                <button
                                    key={group.club._id}
                                    type="button"
                                    className={`story ${group.allSeen ? "" : "has-new"}`}
                                    style={order()}
                                    onClick={() => setWatching(String(group.club._id))}
                                    title={group.club.name}
                                    aria-label={`Watch ${group.club.name}'s story${group.allSeen ? "" : " (new)"}`}
                                >
                                    <span className={`story-ring ${group.allSeen ? "is-seen" : ""}`}>
                                        <Avatar name={group.club.name} src={group.club.logo} size="lg" />
                                    </span>
                                    <span className="story-name">{group.club.name}</span>
                                </button>
                            ))}

                            {quiet
                                .filter((club) => String(club._id) !== String(own?._id))
                                .map((club) => (
                                    <Link key={club._id} to={`/clubs/${club._id}`} className="story story-quiet" title={club.name} style={order()}>
                                        <span className="story-ring is-quiet">
                                            <Avatar name={club.name} src={club.logo} size="lg" />
                                        </span>
                                        <span className="story-name">{club.name}</span>
                                    </Link>
                                ))}

                            {clubs && (
                                <Link to="/clubs" className="story story-more" style={order()}>
                                    <span className="story-ring">
                                        <span className="story-more-icon">
                                            <LayoutGrid size={22} />
                                        </span>
                                    </span>
                                    <span className="story-name">All clubs</span>
                                </Link>
                            )}
                        </>
                    )}
                </div>
                {edges.end && (
                    <button type="button" className="stories-arrow right" onClick={() => scroll(1)} aria-label="Scroll stories right">
                        <ChevronRight size={18} />
                    </button>
                )}
            </div>

            {watching && <StoryViewer groups={playable} startClubId={watching} onClose={() => setWatching(null)} />}
            {postable.length > 0 && <StoryComposer open={composing} onClose={() => setComposing(false)} clubs={postable} />}
        </>
    );
};
