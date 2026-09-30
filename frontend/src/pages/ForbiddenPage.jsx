import { ShieldAlert } from "lucide-react";
import { ButtonLink, EmptyState } from "../components/ui";

const ForbiddenPage = () => (
    <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description="This area is limited to a different role. If you think this is a mistake, contact your university admin."
        action={<ButtonLink to="/feed" variant="secondary">Go home</ButtonLink>}
    />
);

export default ForbiddenPage;
