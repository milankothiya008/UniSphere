import { FileUp, Link2 } from "lucide-react";

// How a question will look to applicants (read-only), used by the form builder's preview.
export const QuestionPreview = ({ question }) => (
    <div className="recruit-preview-q">
        <strong>
            {question.label || "Untitled question"}
            {question.required && <span className="req">*</span>}
        </strong>
        {question.help && <span className="subtle small">{question.help}</span>}
        {question.type === "SHORT" && <div className="recruit-fake-input" />}
        {question.type === "PARAGRAPH" && <div className="recruit-fake-input is-tall" />}
        {question.type === "LINK" && (
            <div className="recruit-fake-input">
                <Link2 size={14} /> https://
            </div>
        )}
        {question.type === "FILE" && (
            <div className="recruit-fake-input is-file">
                <FileUp size={15} /> PDF or image, up to 5 MB
            </div>
        )}
        {["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type) && (
            <div className="recruit-options">
                {question.options.filter((option) => option.trim()).map((option) => (
                    <span key={option} className="recruit-option is-preview">
                        <span className={question.type === "SINGLE_CHOICE" ? "recruit-radio" : "recruit-box"} aria-hidden="true" /> {option}
                    </span>
                ))}
            </div>
        )}
    </div>
);
