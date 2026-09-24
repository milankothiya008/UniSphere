import { Link } from "react-router-dom";
import { Spinner } from "./Feedback";

const classes = ({ variant = "primary", size, block, icon, className }) =>
    ["btn", `btn-${variant}`, size && `btn-${size}`, block && "btn-block", icon && "btn-icon", className].filter(Boolean).join(" ");

export const Button = ({ variant, size, block, icon, loading = false, disabled, className, children, type = "button", ...rest }) => (
    <button type={type} className={classes({ variant, size, block, icon, className })} disabled={disabled || loading} {...rest}>
        {loading && <Spinner size="sm" />}
        {children}
    </button>
);

export const ButtonLink = ({ variant, size, block, icon, className, children, ...rest }) => (
    <Link className={classes({ variant, size, block, icon, className })} {...rest}>
        {children}
    </Link>
);
