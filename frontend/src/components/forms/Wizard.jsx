import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui";

/**
 * Step-by-step forms: an eyebrow and a big title, a numbered stepper, then one section card at a time
 * with Back / Next. Steps the person has reached can be clicked to jump back (or forward to visited ones).
 */
export const Stepper = ({ steps, current, onStep, reached = current, problems = {} }) => (
    <ol className="wiz-steps" aria-label="Steps">
        {steps.map((step, index) => {
            const state = index < current ? "done" : index === current ? "current" : "todo";
            const clickable = onStep && index <= reached && index !== current;
            const body = (
                <>
                    <span className="wiz-dot">{state === "done" && !problems[step.key] ? <Check size={15} strokeWidth={3} /> : index + 1}</span>
                    <span className="wiz-label">{step.label}</span>
                </>
            );
            return (
                <li key={step.key} className={`wiz-step is-${state} ${problems[step.key] ? "has-problem" : ""}`} aria-current={state === "current" ? "step" : undefined}>
                    {clickable ? (
                        <button type="button" onClick={() => onStep(index)} aria-label={`Go to step ${index + 1}: ${step.label}`}>
                            {body}
                        </button>
                    ) : (
                        <span>{body}</span>
                    )}
                </li>
            );
        })}
    </ol>
);

export const WizardHeader = ({ eyebrow, title, back }) => (
    <header className="wiz-head">
        {back}
        {eyebrow && <span className="wiz-eyebrow">{eyebrow}</span>}
        <h1 className="wiz-title">{title}</h1>
    </header>
);

/** One section of a form: a card with its own title and a line about what it's for. */
export const FormSection = ({ title, description, children, aside }) => (
    <section className="wiz-card">
        <div className="wiz-card-head">
            <div>
                <h2>{title}</h2>
                {description && <p>{description}</p>}
            </div>
            {aside}
        </div>
        <div className="wiz-card-body">{children}</div>
    </section>
);

/** Back / Next (or the final action) under the current step. */
export const WizardNav = ({ current, total, onBack, onNext, nextLabel = "Continue", final, disabled }) => (
    <div className="wiz-nav">
        {current > 0 ? (
            <Button variant="secondary" onClick={onBack} type="button">
                <ChevronLeft size={16} /> Back
            </Button>
        ) : (
            <span />
        )}
        <div className="wiz-nav-right">
            <span className="wiz-count">
                Step {current + 1} of {total}
            </span>
            {current < total - 1 ? (
                <Button onClick={onNext} type="button" disabled={disabled}>
                    {nextLabel} <ChevronRight size={16} />
                </Button>
            ) : (
                final
            )}
        </div>
    </div>
);
