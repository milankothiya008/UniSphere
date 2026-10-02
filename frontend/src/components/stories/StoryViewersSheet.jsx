import { useCallback, useEffect, useState } from "react";
import { Eye, Heart, X } from "lucide-react";
import { storyApi } from "../../api/endpoints";
import { Avatar, Button, Spinner } from "../ui";
import { plural, timeAgo } from "../../lib/format";

const detailOf = (user) => [user.departmentCode, user.batchCode && `Batch 20${user.batchCode}`].filter(Boolean).join(" · ") || (user.accountType === "FACULTY" ? "Faculty" : "");

// Bottom sheet over the story listing who watched it (newest first) and who liked it. Club managers only.
export const StoryViewersSheet = ({ story, onClose }) => {
    const [state, setState] = useState({ items: [], page: 0, totalPages: 1, meta: null, loading: true, error: null });

    const load = useCallback(
        async (page) => {
            setState((prev) => ({ ...prev, loading: true, error: null }));
            try {
                const response = await storyApi.viewers(story._id, { page, limit: 50 });
                setState((prev) => ({
                    items: page === 1 ? response.data : [...prev.items, ...response.data],
                    page,
                    totalPages: response.meta.totalPages,
                    meta: response.meta,
                    loading: false,
                    error: null
                }));
            } catch (error) {
                setState((prev) => ({ ...prev, loading: false, error }));
            }
        },
        [story._id]
    );

    useEffect(() => {
        load(1);
    }, [load]);

    const views = state.meta?.viewCount ?? story.viewCount ?? 0;
    const likes = state.meta?.likeCount ?? story.likeCount ?? 0;

    return (
        <div className="sv-sheet" role="dialog" aria-label="Story viewers">
            <button type="button" className="sv-sheet-scrim" onClick={onClose} aria-label="Close viewers" />
            <div className="sv-sheet-panel">
                <span className="sv-sheet-grip" aria-hidden="true" />
                <header className="sv-sheet-head">
                    <div>
                        <h3>Viewers</h3>
                        <p>
                            <Eye size={14} /> {plural(views, "view")}
                            <span aria-hidden="true"> · </span>
                            <Heart size={14} /> {plural(likes, "like")}
                        </p>
                    </div>
                    <button type="button" className="icon-button" onClick={onClose} aria-label="Close viewers">
                        <X size={18} />
                    </button>
                </header>

                <div className="sv-sheet-list">
                    {state.items.map((view) => (
                        <div key={view.user._id} className="sv-viewer">
                            <Avatar name={view.user.name} src={view.user.avatar} />
                            <span className="grow">
                                <strong>{view.user.name}</strong>
                                <small>{[detailOf(view.user), timeAgo(view.viewedAt)].filter(Boolean).join(" · ")}</small>
                            </span>
                            {view.liked && <Heart size={17} className="sv-viewer-liked" aria-label="Liked" />}
                        </div>
                    ))}

                    {state.loading && (
                        <div className="sv-sheet-state">
                            <Spinner /> Loading viewers…
                        </div>
                    )}
                    {!state.loading && state.error && (
                        <div className="sv-sheet-state">
                            {state.error.message}
                            <Button size="sm" variant="secondary" onClick={() => load(Math.max(1, state.page || 1))}>
                                Try again
                            </Button>
                        </div>
                    )}
                    {!state.loading && !state.error && state.items.length === 0 && (
                        <div className="sv-sheet-state">
                            <Eye size={22} />
                            <span>No views yet. People who watch this story will show up here.</span>
                        </div>
                    )}
                    {!state.loading && !state.error && state.page < state.totalPages && (
                        <Button size="sm" variant="secondary" block onClick={() => load(state.page + 1)}>
                            Show more
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};
