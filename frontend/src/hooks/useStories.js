import { useEffect, useState } from "react";
import { storyApi } from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { firstUnseenIndex, preloadStory } from "../lib/stories";

// Shared, in-memory story tray. The feed and club pages read the same copy, it is shown instantly on return
// visits and refreshed quietly in the background (stale-while-revalidate), and seen/liked changes are
// applied locally before the server confirms them.

const REFRESH_AFTER_MS = 30 * 1000;
const POLL_MS = 2 * 60 * 1000;

let state = { userId: null, groups: null, error: null, loadedAt: 0 };
let inflight = null;
const listeners = new Set();

const setState = (next) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
};

const recount = (group) => ({ ...group, allSeen: group.stories.every((story) => story.seen) });

const updateStory = (storyId, change) => {
    if (!state.groups) {
        return;
    }
    setState({
        groups: state.groups.map((group) =>
            group.stories.some((story) => story._id === storyId)
                ? recount({ ...group, stories: group.stories.map((story) => (story._id === storyId ? { ...story, ...change(story) } : story)) })
                : group
        )
    });
};

// Warms the first unwatched story of the first few rings so opening them feels instant.
const warmTray = (groups) => {
    const run = () => groups.filter((group) => !group.allSeen).slice(0, 3).forEach((group) => preloadStory(group.stories[firstUnseenIndex(group)]));
    if (typeof window === "undefined") {
        return;
    }
    (window.requestIdleCallback || ((callback) => setTimeout(callback, 300)))(run);
};

export const loadStories = () => {
    if (!inflight) {
        const userId = state.userId;
        inflight = storyApi
            .tray()
            .then((response) => {
                if (state.userId === userId) {
                    setState({ groups: response.data, error: null, loadedAt: Date.now() });
                    warmTray(response.data);
                }
            })
            .catch((error) => setState({ error, groups: state.groups || [] }))
            .finally(() => {
                inflight = null;
            });
    }
    return inflight;
};

export const markStorySeen = (storyId) => {
    const story = state.groups?.flatMap((group) => group.stories).find((item) => item._id === storyId);
    if (!story || story.seen) {
        return;
    }
    updateStory(storyId, () => ({ seen: true }));
    storyApi.view(storyId).catch(() => {});
};

export const setStoryLiked = async (storyId, liked) => {
    updateStory(storyId, () => ({ liked, seen: true }));
    try {
        await storyApi.like(storyId, liked);
    } catch (error) {
        updateStory(storyId, () => ({ liked: !liked }));
        throw error;
    }
};

export const deleteStory = async (storyId) => {
    await storyApi.remove(storyId);
    if (state.groups) {
        setState({
            groups: state.groups
                .map((group) => ({ ...group, stories: group.stories.filter((story) => story._id !== storyId) }))
                .filter((group) => group.stories.length)
                .map(recount)
        });
    }
};

// For tests.
export const resetStories = () => {
    state = { userId: null, groups: null, error: null, loadedAt: 0 };
    inflight = null;
};

export const useStories = () => {
    const { user } = useAuth();
    const userId = user?._id || null;
    const [snapshot, setSnapshot] = useState(state);

    useEffect(() => {
        if (!userId) {
            return undefined;
        }
        // Seen/liked flags are personal: never show one person's tray to another.
        if (state.userId !== userId) {
            state = { userId, groups: null, error: null, loadedAt: 0 };
            inflight = null;
        }
        listeners.add(setSnapshot);
        setSnapshot(state);

        const refreshIfStale = () => {
            if (Date.now() - state.loadedAt > REFRESH_AFTER_MS) {
                loadStories();
            }
        };
        refreshIfStale();

        const onVisible = () => document.visibilityState === "visible" && refreshIfStale();
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", refreshIfStale);
        const timer = setInterval(() => document.visibilityState === "visible" && loadStories(), POLL_MS);

        return () => {
            listeners.delete(setSnapshot);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", refreshIfStale);
            clearInterval(timer);
        };
    }, [userId]);

    return { groups: snapshot.groups, error: snapshot.error, loading: !snapshot.groups, reload: loadStories };
};
