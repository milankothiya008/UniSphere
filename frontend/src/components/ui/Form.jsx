import { useId } from "react";
import { Search } from "lucide-react";

export const Field = ({ label, hint, error, required, htmlFor, className = "", children }) => (
    <div className={`field ${className}`}>
        {label && (
            <label className="field-label" htmlFor={htmlFor}>
                {label}
                {required && <span className="req">*</span>}
            </label>
        )}
        {children}
        {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
);

const useFieldId = (id) => {
    const generated = useId();
    return id || generated;
};

export const Input = ({ label, hint, error, required, className, id, ...rest }) => {
    const fieldId = useFieldId(id);
    return (
        <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId} className={className}>
            <input id={fieldId} className="input" aria-invalid={Boolean(error)} required={required} {...rest} />
        </Field>
    );
};

export const Textarea = ({ label, hint, error, required, className, id, ...rest }) => {
    const fieldId = useFieldId(id);
    return (
        <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId} className={className}>
            <textarea id={fieldId} className="textarea" aria-invalid={Boolean(error)} required={required} {...rest} />
        </Field>
    );
};

export const Select = ({ label, hint, error, required, className, id, options = [], placeholder, children, ...rest }) => {
    const fieldId = useFieldId(id);
    return (
        <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId} className={className}>
            <select id={fieldId} className="select" aria-invalid={Boolean(error)} required={required} {...rest}>
                {placeholder !== undefined && <option value="">{placeholder}</option>}
                {options.map((option) => {
                    const { value, label: text, disabled } = typeof option === "object" ? option : { value: option, label: option };
                    return (
                        <option key={value} value={value} disabled={disabled}>
                            {text}
                        </option>
                    );
                })}
                {children}
            </select>
        </Field>
    );
};

// An on/off setting. The whole row is the control, so the label and description are clickable too.
export const Switch = ({ checked, onChange, label, description, disabled = false }) => (
    <button type="button" role="switch" aria-checked={checked} className={`switch-row ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} disabled={disabled}>
        <span className="switch-text">
            <strong>{label}</strong>
            {description && <small>{description}</small>}
        </span>
        <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
        </span>
    </button>
);

export const Checkbox = ({ label, ...rest }) => (
    <label className="checkbox">
        <input type="checkbox" {...rest} />
        {label}
    </label>
);

export const SearchInput = ({ value, onChange, placeholder = "Search…", ...rest }) => (
    <div className="input-with-icon">
        <Search size={16} />
        <input
            type="search"
            className="input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            {...rest}
        />
    </div>
);
