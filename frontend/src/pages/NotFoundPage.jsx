import { Compass } from "lucide-react";
import { ButtonLink, EmptyState } from "../components/ui";

const NotFoundPage = () => (
    <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={<ButtonLink to="/dashboard" variant="secondary">Back to dashboard</ButtonLink>}
    />
);

export default NotFoundPage;
