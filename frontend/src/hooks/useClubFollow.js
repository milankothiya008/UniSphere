import { useCallback, useEffect, useState } from "react";
import { clubApi } from "../api/endpoints";

// Follow state per club, shared by every post on the page: following a club from one post updates
// the "Follow" button on all of that club's posts at once.

const follows = new Map();
const listeners = new Set();

const publish = (clubId, value) => {
    follows.set(clubId, value);
    listeners.forEach((listener) => listener());
};

export const useClubFollow = (clubId, initial) => {
    const read = useCallback(() => (follows.has(clubId) ? follows.get(clubId) : Boolean(initial)), [clubId, initial]);
    const [following, setFollowing] = useState(read);

    useEffect(() => {
        const listener = () => setFollowing(read());
        listeners.add(listener);
        listener();
        return () => listeners.delete(listener);
    }, [read]);

    const follow = useCallback(async () => {
        publish(clubId, true);
        try {
            const { data } = await clubApi.setSubscription(clubId, true);
            publish(clubId, Boolean(data.subscribed));
            return data;
        } catch (error) {
            publish(clubId, false);
            throw error;
        }
    }, [clubId]);

    return { following, follow };
};

/** For other follow controls (the club page's button), so feed posts stay in step. */
export const setClubFollow = (clubId, value) => publish(clubId, Boolean(value));
