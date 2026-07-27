"use client";

import { useMemo, useState } from "react";
import {
  applyContextBindings,
  questionIsVisible,
  validateSurveyAnswers,
  type SurveyAnswers,
  type SurveyDefinition,
  type SurveyQuestion,
} from "@/lib/surveys/definition";

export type RenderedSurveyAttachment = {
  id: string;
  question_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export function SurveyRenderer({
  definition,
  answers,
  onChange,
  errors = {},
  readOnly = false,
  context = {},
  attachments = [],
  onUpload,
  onRemove,
  onDownload,
  preview = false,
}: {
  definition: SurveyDefinition;
  answers: SurveyAnswers;
  onChange?: (questionId: string, value: unknown) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
  context?: Record<string, unknown>;
  attachments?: RenderedSurveyAttachment[];
  onUpload?: (questionId: string, file: File) => void;
  onRemove?: (attachmentId: string) => void;
  onDownload?: (attachmentId: string) => void;
  preview?: boolean;
}) {
  const boundAnswers = useMemo(
    () => applyContextBindings(definition, answers, context),
    [answers, context, definition],
  );
  const pages = useMemo(() => {
    if (definition.presentation === "one_page") return [definition.sections];
    return definition.sections.reduce<SurveyDefinition["sections"][]>((groups, section, index) => {
      if (!groups.length || (section.pageBreakBefore && index > 0)) groups.push([]);
      groups.at(-1)!.push(section);
      return groups;
    }, []);
  }, [definition]);
  const [page, setPage] = useState(0);
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const visiblePage = Math.min(page, pages.length - 1);
  const displayedErrors = { ...pageErrors, ...errors };

  function nextPage() {
    const questionIds = new Set(pages[visiblePage].flatMap((section) => section.questions.map((question) => question.id)));
    const attachmentIds = new Set(attachments.map((attachment) => attachment.question_id));
    const validation = validateSurveyAnswers(definition, boundAnswers, attachmentIds);
    const relevant = Object.fromEntries(Object.entries(validation.errors).filter(([id]) => questionIds.has(id)));
    setPageErrors(relevant);
    if (Object.keys(relevant).length) return;
    setPage((current) => Math.min(current + 1, pages.length - 1));
  }

  return <div className={`dynamic-survey ${preview ? "survey-preview" : ""}`}>
    <div className="dynamic-survey-copy">
      {definition.introduction && <p className="survey-introduction">{definition.introduction}</p>}
      {definition.instructions && <p className="survey-instructions">{definition.instructions}</p>}
      {pages.length > 1 && <p className="survey-page-progress" aria-live="polite">
        Page {visiblePage + 1} of {pages.length}
      </p>}
    </div>
    <div className="survey-form">
      {pages[visiblePage].map((section) => <section key={section.id}>
        <h2>{section.title}</h2>
        {section.description && <p className="muted">{section.description}</p>}
        <div className="dynamic-survey-grid">
          {section.questions.filter((question) => questionIsVisible(question, boundAnswers)).map((question) =>
            <Question key={question.id} question={question} value={boundAnswers[question.id]}
              onChange={(value) => onChange?.(question.id, value)}
              error={displayedErrors[question.id]} readOnly={readOnly}
              contextBound={Boolean(question.contextBinding && context[question.contextBinding] != null)}
              attachments={attachments.filter((attachment) => attachment.question_id === question.id)}
              onUpload={onUpload} onRemove={onRemove} onDownload={onDownload} preview={preview} />)}
        </div>
      </section>)}
    </div>
    {pages.length > 1 && <nav className="survey-page-actions" aria-label="Survey pages">
      <button type="button" className="secondary" disabled={visiblePage === 0}
        onClick={() => { setPageErrors({}); setPage((current) => Math.max(0, current - 1)); }}>
        {definition.buttons.previous}
      </button>
      {visiblePage < pages.length - 1 && <button type="button" onClick={nextPage}>{definition.buttons.next}</button>}
    </nav>}
  </div>;
}

function Question({
  question,
  value,
  onChange,
  error,
  readOnly,
  contextBound,
  attachments,
  onUpload,
  onRemove,
  onDownload,
  preview,
}: {
  question: SurveyQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  readOnly: boolean;
  contextBound: boolean;
  attachments: RenderedSurveyAttachment[];
  onUpload?: (questionId: string, file: File) => void;
  onRemove?: (attachmentId: string) => void;
  onDownload?: (attachmentId: string) => void;
  preview: boolean;
}) {
  const className = `survey-question width-${question.width}${error ? " field-error" : ""}`;
  if (readOnly) return <div className={className}>
    <div className="survey-question-label">{question.label}</div>
    {question.helpText && <p className="survey-help">{question.helpText}</p>}
    <ReadOnlyAnswer question={question} value={value} attachments={attachments} onDownload={onDownload} />
  </div>;

  const label = <span>{question.label}{question.required && <span className="required" aria-hidden="true"> *</span>}</span>;
  const description = <>{question.helpText && <small className="survey-help">{question.helpText}</small>}
    {contextBound && <small className="survey-help">This value comes from trusted course context.</small>}
    {error && <span className="field-error-message" role="alert">{error}</span>}</>;
  const disabled = contextBound;
  if (question.type === "yes_no") return <fieldset className={className} disabled={disabled}>
    <legend>{label}</legend>{description}
    <Radio label="Yes" name={question.id} checked={value === true} onChange={() => onChange(true)} />
    <Radio label="No" name={question.id} checked={value === false} onChange={() => onChange(false)} />
  </fieldset>;
  if (question.type === "single_choice") {
    const selectedOption = question.options?.find((option) => option.id === value || option.label === value);
    return <label className={className}>{label}{description}
    <select value={selectedOption?.id ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select an option</option>
      {question.options?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>;
  }
  if (question.type === "multiple_choice") {
    const selected = Array.isArray(value) ? value as string[] : [];
    return <fieldset className={className}><legend>{label}</legend>{description}
      {question.options?.map((option) => <label className="survey-radio" key={option.id}>
        <input type="checkbox" checked={selected.includes(option.id)} onChange={(event) =>
          onChange(event.target.checked ? [...selected, option.id] : selected.filter((item) => item !== option.id))} />
        <span>{option.label}</span>
      </label>)}
    </fieldset>;
  }
  if (question.type === "rating_scale") return <fieldset className={className}>
    <legend>{label}</legend>{description}
    <div className="dynamic-rating-scale">
      {ratingValues(question).map((rating) => <Radio key={rating} name={question.id}
        label={ratingLabel(question, rating)} checked={Number(value) === rating} onChange={() => onChange(rating)} />)}
    </div>
    <div className="rating-endpoints"><span>{question.scale?.minLabel}</span><span>{question.scale?.maxLabel}</span></div>
  </fieldset>;
  if (question.type === "rating_matrix") return <fieldset className={`${className} dynamic-matrix-fieldset`}>
    <legend>{label}</legend>{description}
    <div className="survey-matrix-wrap"><table className="survey-matrix">
      <thead><tr><th>Statement</th>{ratingValues(question).map((rating) =>
        <th key={rating}>{rating}<small>{question.scale?.labels?.[rating - (question.scale?.min ?? 0)] ?? ""}</small></th>)}</tr></thead>
      <tbody>{question.rows?.map((row) => <tr key={row.id}>
        <th scope="row" id={`${question.id}-${row.id}`}>{row.label}</th>
        {ratingValues(question).map((rating) => <td key={rating}><label>
          <input type="radio" name={`${question.id}-${row.id}`} checked={Number((value as Record<string, unknown> | undefined)?.[row.id]) === rating}
            onChange={() => onChange({ ...(typeof value === "object" && value ? value as object : {}), [row.id]: rating })}
            aria-labelledby={`${question.id}-${row.id}`} />
          <span>{ratingLabel(question, rating)}</span>
        </label></td>)}
      </tr>)}</tbody>
    </table></div>
  </fieldset>;
  if (question.type === "file_upload") return <div className={className}>
    <div className="survey-question-label">{label}</div>{description}
    {attachments.map((attachment) => <div className="survey-file" key={attachment.id}>
      <span>{attachment.original_filename} ({formatBytes(attachment.size_bytes)})</span><span>
        {onDownload && <button type="button" className="link-button" onClick={() => onDownload(attachment.id)}>Download</button>}
        {onRemove && <button type="button" className="link-button danger" onClick={() => onRemove(attachment.id)}>Remove</button>}
      </span>
    </div>)}
    <label className="survey-upload">Choose file
      <input type="file" disabled={preview} accept={(question.validation.allowedExtensions ?? []).map((item) => `.${item}`).join(",")}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload?.(question.id, file); }} />
    </label>
    {preview && <small className="survey-help">Uploads are disabled in preview.</small>}
  </div>;
  const isLong = question.type === "long_text";
  if (isLong) return <label className={className}>{label}{description}
    <textarea rows={6} value={String(value ?? "")} minLength={question.validation.minLength}
      maxLength={question.validation.maxLength ?? 10_000} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} />
  </label>;
  const inputType = question.type === "date" ? "date" : question.type === "number" || question.type === "currency" ? "number" : "text";
  return <label className={className}>{label}{description}
    <input type={inputType} value={String(value ?? "")} disabled={disabled}
      min={question.type === "date" ? question.validation.earliest : question.validation.min}
      max={question.type === "date" ? question.validation.latest : question.validation.max}
      step={question.type === "currency" ? question.validation.step ?? 0.01 : question.validation.step}
      minLength={inputType === "text" ? question.validation.minLength : undefined}
      maxLength={inputType === "text" ? question.validation.maxLength : undefined}
      onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function ReadOnlyAnswer({ question, value, attachments, onDownload }: {
  question: SurveyQuestion;
  value: unknown;
  attachments: RenderedSurveyAttachment[];
  onDownload?: (id: string) => void;
}) {
  if (question.type === "file_upload") return attachments.length
    ? <>{attachments.map((attachment) => <div className="survey-file" key={attachment.id}>
      <span>{attachment.original_filename} ({formatBytes(attachment.size_bytes)})</span>
      {onDownload && <button type="button" className="link-button" onClick={() => onDownload(attachment.id)}>Download</button>}
    </div>)}</> : <p>Not provided</p>;
  if (question.type === "rating_matrix") {
    const matrix = typeof value === "object" && value ? value as Record<string, unknown> : {};
    return <ol className="restricted-rating-list">{question.rows?.map((row) => {
      const rating = Number(matrix[row.id]);
      return <li key={row.id}><span>{row.label}</span><strong>{Number.isFinite(rating) && rating
        ? ratingLabel(question, rating) : "Not provided"}</strong></li>;
    })}</ol>;
  }
  if (question.type === "multiple_choice") {
    const selected = Array.isArray(value) ? value : [];
    return <p>{selected.length ? selected.map((item) =>
      question.options?.find((option) => option.id === item)?.label ?? String(item)).join(", ") : "Not provided"}</p>;
  }
  if (question.type === "single_choice") {
    return <p>{question.options?.find((option) => option.id === value || option.label === value)?.label ?? String(value || "Not provided")}</p>;
  }
  if (question.type === "yes_no") return <p>{value === true ? "Yes" : value === false ? "No" : "Not provided"}</p>;
  if (question.type === "currency" && value !== "" && value != null) {
    return <p>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value))}</p>;
  }
  if (question.type === "rating_scale" && value !== "" && value != null) return <p>{ratingLabel(question, Number(value))}</p>;
  return <p className={question.type === "long_text" ? "survey-comment-readonly" : undefined}>{String(value || "Not provided")}</p>;
}

function Radio({ label, name, checked, onChange }: { label: string; name: string; checked: boolean; onChange: () => void }) {
  return <label className="survey-radio"><input type="radio" name={name} checked={checked} onChange={onChange} /><span>{label}</span></label>;
}

function ratingValues(question: SurveyQuestion) {
  if (!question.scale) return [];
  return Array.from({ length: question.scale.max - question.scale.min + 1 }, (_, index) => question.scale!.min + index);
}

function ratingLabel(question: SurveyQuestion, rating: number) {
  const label = question.scale?.labels?.[rating - (question.scale?.min ?? 0)];
  return label ? `${rating} — ${label}` : String(rating);
}

function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
