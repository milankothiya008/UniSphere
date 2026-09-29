import { useState } from "react";
import { Link } from "react-router-dom";
import { BellOff, Mail, ShieldCheck, UserCheck } from "lucide-react";
import { clubApi, notificationApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useToast } from "../context/ToastContext";
import { AsyncContent, Avatar, Button, Card, EmptyState, PageHeader, Switch } from "../components/ui";
import { humanize } from "../lib/format";

const EmailPreferences = () => {
    const toast = useToast();
    const { data, loading, error, reload, setData } = useApi(() => notificationApi.preferences(), []);
    const [saving, setSaving] = useState(null);

    const change = async (key, value) => {
        setSaving(key);
        const previous = data.preferences;
        setData({ ...data, preferences: { ...previous, [key]: value } });
        try {
            const response = await notificationApi.updatePreferences({ [key]: value });
            setData(response.data);
            toast.success("Email settings saved");
        } catch (err) {
            setData({ ...data, preferences: previous });
            toast.error(err);
        } finally {
            setSaving(null);
        }
    };

    return (
        <Card title={<h2 className="row"><Mail size={17} /> Email notifications</h2>}>
            <AsyncContent loading={loading} error={error} onRetry={reload}>
                {data && (
                    <div className="stack">
                        <div className="switch-list">
                            {data.categories.map((category) => (
                                <Switch
                                    key={category.key}
                                    label={category.label}
                                    description={category.description}
                                    checked={data.preferences[category.key]}
                                    onChange={(value) => change(category.key, value)}
                                    disabled={saving === category.key}
                                />
                            ))}
                        </div>
                        <p className="subtle row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
                            <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                            Account emails — verification codes, password resets, approvals and registration confirmations — are always sent.
                        </p>
                    </div>
                )}
            </AsyncContent>
        </Card>
    );
};

const FollowedClubs = () => {
    const toast = useToast();
    const { data, loading, error, reload, setData } = useApi(() => notificationApi.subscriptions(), []);

    const turnOff = async (row) => {
        try {
            await clubApi.setSubscription(row.club._id, false);
            setData((list) => list.filter((item) => item.club._id !== row.club._id));
            toast.info(`You unfollowed ${row.club.name}`);
        } catch (err) {
            toast.error(err);
        }
    };

    return (
        <Card title={<h2 className="row"><UserCheck size={17} /> Clubs you follow</h2>}>
            <AsyncContent
                loading={loading}
                error={error}
                onRetry={reload}
                isEmpty={!data?.length}
                empty={
                    <EmptyState
                        icon={BellOff}
                        title="No clubs yet"
                        description="Follow a club from its page to get emails about its new events and announcements."
                        action={
                            <Link to="/clubs" className="btn btn-secondary btn-sm">
                                Browse clubs
                            </Link>
                        }
                    />
                }
            >
                <div className="list-rows">
                    {data?.map((row) => (
                        <div key={row.club._id} className="list-row">
                            <Avatar name={row.club.name} src={row.club.logo} square />
                            <div className="grow">
                                <Link to={`/clubs/${row.club._id}`} className="title">
                                    {row.club.name}
                                </Link>
                                <div className="subtle">
                                    {humanize(row.club.category)}
                                    {row.isMember ? " · Member (on by default)" : " · Following"}
                                </div>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => turnOff(row)}>
                                Unfollow
                            </Button>
                        </div>
                    ))}
                </div>
            </AsyncContent>
        </Card>
    );
};

const NotificationSettingsPage = () => (
    <>
        <PageHeader
            back={{ to: "/notifications", label: "Notifications" }}
            eyebrow={<><Mail size={14} /> Settings</>}
            title="Notification settings"
            description="Choose which emails CampusConnect sends you. In-app notifications always appear under the bell at the top."
        />
        <div className="stack-lg" style={{ maxWidth: 760 }}>
            <EmailPreferences />
            <FollowedClubs />
        </div>
    </>
);

export default NotificationSettingsPage;
