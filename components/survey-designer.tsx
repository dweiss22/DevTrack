"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SurveyRenderer } from "@/components/survey-renderer";
import {
  CONDITION_OPERATORS,
  CONTEXT_BINDINGS,
  QUESTION_TYPES,
  QUESTION_WIDTHS,
  surveyDefinitionSchema,
  type SurveyAnswers,
  type SurveyDefinition,
  type SurveyQuestion,
  type SurveyQuestionType,
} from "@/lib/surveys/definition";
import { SURVEY_VERTICALS } from "@/lib/surveys/domain";

const trustedSmeEmploymentCondition: SurveyQuestion = {
  id: "internalEmployee",
  type: "yes_no",
  label: "SME is an internal employee (trusted)",
  helpText: "",
  required: false,
  width: "full",
  validation: {},
};

export function SurveyDesigner({ templateId, initialDefinition, initialLockVersion }: {
  templateId: string;
  initialDefinition: SurveyDefinition;
  initialLockVersion: number;
}) {
  const router = useRouter();
  const [definition, setDefinition] = useState(initialDefinition);
  const [lockVersion, setLockVersion] = useState(initialLockVersion);
  const [baseline, setBaseline] = useState(JSON.stringify(initialDefinition));
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewClassification, setPreviewClassification] = useState<"internal" | "external">("external");
  const [previewAnswers, setPreviewAnswers] = useState<SurveyAnswers>({});
  const dirty = JSON.stringify(definition) !== baseline;
  const previewContext = useMemo(() => definition.surveyType === "course_development_debrief" ? {
    smeName: "Preview SME", smeEmail: "preview.sme@example.com",
    smeClassification: previewClassification, reportingYear: 2026,
    taskTitle: "Preview course", courseName: "Preview course",
  } : {
    respondentName: "Preview Instructional Designer", taskTitle: "Preview course",
    courseName: "Preview course", reviewedSmeName: "Preview SME",
    vertical: "P1A", reportingYear: 2026,
  }, [definition.surveyType, previewClassification]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function mutate(mutator: (draft: SurveyDefinition) => void) {
    setDefinition((current) => {
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
    setMessage(""); setError(false);
  }

  async function saveDraft() {
    const parsed = surveyDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      setError(true); setMessage(parsed.error.issues[0]?.message ?? "Review the survey definition.");
      return null;
    }
    setWorking(true); setMessage(""); setError(false);
    try {
      const response = await fetch(`/api/admin/surveys/templates/${templateId}/draft`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: parsed.data, expectedLockVersion: lockVersion }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The draft could not be saved.");
      setDefinition(parsed.data);
      setLockVersion(payload.lockVersion);
      setBaseline(JSON.stringify(parsed.data));
      setMessage("Survey draft saved.");
      return payload.lockVersion as number;
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The draft could not be saved.");
      return null;
    } finally { setWorking(false); }
  }

  async function publish() {
    const saved = dirty ? await saveDraft() : lockVersion;
    if (!saved) return;
    setWorking(true); setMessage(""); setError(false);
    try {
      const response = await fetch(`/api/admin/surveys/templates/${templateId}/publish`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The survey could not be published.");
      setMessage(`Version ${payload.version} published. New surveys now use this version.`);
      router.refresh();
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The survey could not be published.");
    } finally { setWorking(false); }
  }

  function addSection() {
    mutate((draft) => draft.sections.push({
      id: uniqueId("section"), title: "New section", description: "", pageBreakBefore: draft.sections.length > 0, questions: [],
    }));
  }

  return <div className="survey-designer">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <section className="card designer-basics">
      <div className="section-heading"><div><p className="eyebrow">CONTENT AND PRESENTATION</p><h2>Survey settings</h2></div>
        <span>{dirty ? "Unsaved changes" : `Draft revision ${lockVersion}`}</span></div>
      <div className="survey-form-grid">
        <label>Title<input value={definition.title} maxLength={200} onChange={(event) => mutate((draft) => { draft.title = event.target.value; })} /></label>
        <label>Presentation<select value={definition.presentation} onChange={(event) => mutate((draft) => { draft.presentation = event.target.value as SurveyDefinition["presentation"]; })}>
          <option value="one_page">One page</option><option value="multi_page">Multiple pages</option>
        </select></label>
      </div>
      <label>Introduction<textarea rows={3} maxLength={5000} value={definition.introduction} onChange={(event) => mutate((draft) => { draft.introduction = event.target.value; })} /></label>
      <label>Instructions<textarea rows={3} maxLength={5000} value={definition.instructions} onChange={(event) => mutate((draft) => { draft.instructions = event.target.value; })} /></label>
      <label>Completion message<textarea rows={3} maxLength={5000} value={definition.completionMessage} onChange={(event) => mutate((draft) => { draft.completionMessage = event.target.value; })} /></label>
      <div className="designer-button-labels">
        {Object.entries(definition.buttons).map(([key, value]) => <label key={key}>{buttonLabel(key)}
          <input value={value} maxLength={80} onChange={(event) => mutate((draft) => {
            draft.buttons[key as keyof SurveyDefinition["buttons"]] = event.target.value;
          })} /></label>)}
      </div>
    </section>

    <div className="designer-sections">{definition.sections.map((section, sectionIndex) => {
      const earlierQuestions = definition.sections
        .slice(0, sectionIndex)
        .flatMap((item) => item.questions);
      const priorQuestions = definition.surveyType === "course_development_debrief"
        ? [
          trustedSmeEmploymentCondition,
          ...earlierQuestions.filter((question) => !question.contextBinding),
        ]
        : earlierQuestions;
      return <section className="card designer-section" key={section.id}>
        <div className="section-heading"><div><p className="eyebrow">SECTION {sectionIndex + 1}</p>
          <input aria-label={`Section ${sectionIndex + 1} title`} value={section.title} maxLength={200}
            onChange={(event) => mutate((draft) => { draft.sections[sectionIndex].title = event.target.value; })} /></div>
          <ReorderButtons index={sectionIndex} count={definition.sections.length}
            move={(offset) => mutate((draft) => moveItem(draft.sections, sectionIndex, sectionIndex + offset))}
            remove={() => mutate((draft) => draft.sections.splice(sectionIndex, 1))} />
        </div>
        <label>Section description<textarea rows={2} maxLength={1000} value={section.description}
          onChange={(event) => mutate((draft) => { draft.sections[sectionIndex].description = event.target.value; })} /></label>
        {definition.presentation === "multi_page" && sectionIndex > 0 && <label className="checkbox-row">
          <input type="checkbox" checked={section.pageBreakBefore}
            onChange={(event) => mutate((draft) => { draft.sections[sectionIndex].pageBreakBefore = event.target.checked; })} />
          Start a new page before this section
        </label>}
        <div className="designer-questions">{section.questions.map((question, questionIndex) =>
          <QuestionEditor key={question.id} question={question} questionIndex={questionIndex}
            sectionIndex={sectionIndex} count={section.questions.length}
            priorQuestions={[
              ...priorQuestions,
              ...section.questions.slice(0, questionIndex).filter((candidate) =>
                definition.surveyType !== "course_development_debrief"
                || !candidate.contextBinding),
            ]}
            mutate={mutate} />)}</div>
        <button type="button" className="secondary" onClick={() => mutate((draft) =>
          draft.sections[sectionIndex].questions.push(newQuestion("short_text")))}>Add question</button>
      </section>;
    })}</div>
    <button type="button" className="secondary" onClick={addSection} disabled={definition.sections.length >= 30}>Add section</button>

    <footer className="designer-actions">
      <button type="button" className="secondary" onClick={() => setPreview(true)}>Preview</button>
      <button type="button" className="secondary" onClick={() => void saveDraft()} disabled={working || !dirty}>{working ? "Working…" : definition.buttons.saveDraft}</button>
      <button type="button" onClick={() => void publish()} disabled={working}>{working ? "Working…" : "Publish new version"}</button>
    </footer>

    {preview && <div className="modal-backdrop designer-preview-backdrop">
      <section className="designer-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <header><div><p className="eyebrow">SAFE RENDERER PREVIEW</p><h2 id="preview-title">{definition.title}</h2></div>
          <div className="table-actions"><button type="button" className={previewDevice === "desktop" ? "" : "secondary"} onClick={() => setPreviewDevice("desktop")}>Desktop</button>
            <button type="button" className={previewDevice === "mobile" ? "" : "secondary"} onClick={() => setPreviewDevice("mobile")}>Mobile</button>
            {definition.surveyType === "course_development_debrief" && <label>Preview SME type
              <select value={previewClassification} onChange={(event) =>
                setPreviewClassification(event.target.value as "internal" | "external")}>
                <option value="external">External</option><option value="internal">Internal</option>
              </select>
            </label>}
            <button type="button" className="secondary" onClick={() => setPreview(false)}>Close preview</button></div></header>
        <div className={`designer-preview-frame ${previewDevice}`}>
          <SurveyRenderer definition={definition} answers={previewAnswers}
            context={previewContext}
            onChange={(id, value) => setPreviewAnswers((current) => ({ ...current, [id]: value }))} preview />
        </div>
      </section>
    </div>}
  </div>;
}

function QuestionEditor({ question, questionIndex, sectionIndex, count, priorQuestions, mutate }: {
  question: SurveyQuestion;
  questionIndex: number;
  sectionIndex: number;
  count: number;
  priorQuestions: SurveyQuestion[];
  mutate: (callback: (definition: SurveyDefinition) => void) => void;
}) {
  const choiceType = question.type === "single_choice" || question.type === "multiple_choice";
  const matrix = question.type === "rating_matrix";
  const rating = question.type === "rating_scale" || matrix;
  const validation = question.validation;
  const update = (callback: (target: SurveyQuestion) => void) => mutate((definition) =>
    callback(definition.sections[sectionIndex].questions[questionIndex]));
  const duplicate = () => mutate((definition) => {
    const copy = structuredClone(definition.sections[sectionIndex].questions[questionIndex]);
    copy.id = uniqueId("question");
    copy.label = `Copy of ${copy.label}`;
    definition.sections[sectionIndex].questions.splice(questionIndex + 1, 0, copy);
  });

  return <article className="designer-question">
    <div className="section-heading"><strong>Question {questionIndex + 1}</strong>
      <div className="table-actions"><button type="button" className="secondary" onClick={duplicate}>Duplicate</button>
        <ReorderButtons index={questionIndex} count={count}
          move={(offset) => mutate((definition) => moveItem(definition.sections[sectionIndex].questions, questionIndex, questionIndex + offset))}
          remove={() => mutate((definition) => definition.sections[sectionIndex].questions.splice(questionIndex, 1))} /></div></div>
    <div className="designer-question-grid">
      <label>Question type<select value={question.type} onChange={(event) => update((target) => resetQuestionType(target, event.target.value as SurveyQuestionType))}>
        {QUESTION_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
      </select></label>
      <label>Layout width<select value={question.width} onChange={(event) => update((target) => { target.width = event.target.value as SurveyQuestion["width"]; })}>
        {QUESTION_WIDTHS.map((width) => <option key={width} value={width}>{width}</option>)}
      </select></label>
      <label className="designer-question-label">Label<input value={question.label} maxLength={1000} onChange={(event) => update((target) => { target.label = event.target.value; })} /></label>
      <label className="checkbox-row"><input type="checkbox" checked={question.required}
        disabled={Boolean(question.contextBinding)}
        onChange={(event) => update((target) => { target.required = event.target.checked; })} />
        {question.contextBinding ? "Trusted context (read-only)" : "Required"}</label>
      <label className="designer-question-label">Help text<textarea rows={2} maxLength={1000} value={question.helpText} onChange={(event) => update((target) => { target.helpText = event.target.value; })} /></label>
      <label>Trusted context<select value={question.contextBinding ?? ""} onChange={(event) => update((target) => {
        applyContextBinding(target, event.target.value as SurveyQuestion["contextBinding"] | "");
      })}><option value="">None</option>{CONTEXT_BINDINGS.map((binding) =>
        <option key={binding} value={binding}>{contextBindingLabel(binding)}</option>)}</select></label>
    </div>
    {(question.type === "short_text" || question.type === "long_text") && <div className="designer-inline-fields">
      <NumberSetting label="Minimum characters" value={validation.minLength} change={(value) => update((target) => { target.validation.minLength = value; })} />
      <NumberSetting label="Maximum characters" value={validation.maxLength} change={(value) => update((target) => { target.validation.maxLength = value; })} />
    </div>}
    {(question.type === "number" || question.type === "currency") && <div className="designer-inline-fields">
      <NumberSetting label="Minimum" value={validation.min} change={(value) => update((target) => { target.validation.min = value; })} />
      <NumberSetting label="Maximum" value={validation.max} change={(value) => update((target) => { target.validation.max = value; })} />
      <NumberSetting label="Step" value={validation.step} change={(value) => update((target) => { target.validation.step = value; })} />
    </div>}
    {choiceType && <label>Choices, one per line<textarea rows={5} value={(question.options ?? []).map((option) => option.label).join("\n")}
      onChange={(event) => update((target) => {
        target.options = lines(event.target.value).map((label, index) => ({ id: optionId(label, index), label }));
      })} /></label>}
    {matrix && <label>Matrix rows, one per line<textarea rows={6} value={(question.rows ?? []).map((row) => row.label).join("\n")}
      onChange={(event) => update((target) => {
        target.rows = lines(event.target.value).map((label, index) => ({ id: optionId(label, index), label }));
      })} /></label>}
    {rating && <div className="designer-inline-fields">
      <NumberSetting label="Scale minimum" value={question.scale?.min} change={(value) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }), min: value ?? 1 };
      })} />
      <NumberSetting label="Scale maximum" value={question.scale?.max} change={(value) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }), max: value ?? 5 };
      })} />
      <label>Minimum endpoint<input value={question.scale?.minLabel ?? ""} maxLength={200} onChange={(event) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }), minLabel: event.target.value };
      })} /></label>
      <label>Maximum endpoint<input value={question.scale?.maxLabel ?? ""} maxLength={200} onChange={(event) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }), maxLabel: event.target.value };
      })} /></label>
      <label>Display order<select value={question.scale?.displayOrder ?? "ascending"} onChange={(event) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }),
          displayOrder: event.target.value as "ascending" | "descending" };
      })}><option value="ascending">Lowest to highest</option><option value="descending">Highest to lowest</option></select></label>
      <label>Minimum description<input value={question.scale?.minDescription ?? ""} maxLength={1000} onChange={(event) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }), minDescription: event.target.value };
      })} /></label>
      <label>Maximum description<input value={question.scale?.maxDescription ?? ""} maxLength={1000} onChange={(event) => update((target) => {
        target.scale = { ...(target.scale ?? { min: 1, max: 5, minLabel: "", maxLabel: "" }), maxDescription: event.target.value };
      })} /></label>
    </div>}
    {question.type === "file_upload" && <label>Allowed file extensions<input value={(question.validation.allowedExtensions ?? []).join(", ")}
      onChange={(event) => update((target) => {
        target.validation.allowedExtensions = event.target.value.split(",").map((value) => value.trim().toLowerCase())
          .filter((value): value is NonNullable<SurveyQuestion["validation"]["allowedExtensions"]>[number] =>
            ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"].includes(value));
      })} /></label>}
    <fieldset className="designer-conditions"><legend>Conditional visibility</legend>
      {(question.visibility?.rules ?? []).map((rule, ruleIndex) => <div className="designer-condition" key={`${rule.questionId}:${ruleIndex}`}>
        <select aria-label="Earlier question" value={rule.questionId} onChange={(event) => update((target) => {
          target.visibility!.rules[ruleIndex].questionId = event.target.value;
        })}>{priorQuestions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select>
        <select aria-label="Condition operator" value={rule.operator} onChange={(event) => update((target) => {
          target.visibility!.rules[ruleIndex].operator = event.target.value as typeof rule.operator;
        })}>{CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator.replaceAll("_", " ")}</option>)}</select>
        {!["answered", "not_answered"].includes(rule.operator) && <input aria-label="Condition value" value={String(rule.value ?? "")}
          onChange={(event) => update((target) => { target.visibility!.rules[ruleIndex].value = parseConditionValue(event.target.value); })} />}
        <button type="button" className="secondary danger" onClick={() => update((target) => {
          target.visibility!.rules.splice(ruleIndex, 1);
          if (!target.visibility!.rules.length) target.visibility = undefined;
        })}>Remove</button>
      </div>)}
      <button type="button" className="secondary" disabled={!priorQuestions.length} onClick={() => update((target) => {
        target.visibility ??= { match: "all", rules: [] };
        target.visibility.rules.push({ questionId: priorQuestions.at(-1)!.id, operator: "equals", value: true });
      })}>Add condition</button>
      {question.visibility && <label>Match<select value={question.visibility.match} onChange={(event) => update((target) => {
        target.visibility!.match = event.target.value as "all" | "any";
      })}><option value="all">All conditions</option><option value="any">Any condition</option></select></label>}
    </fieldset>
  </article>;
}

function ReorderButtons({ index, count, move, remove }: {
  index: number; count: number; move: (offset: number) => void; remove: () => void;
}) {
  return <div className="table-actions">
    <button type="button" className="secondary" disabled={index === 0} onClick={() => move(-1)} aria-label="Move up">↑</button>
    <button type="button" className="secondary" disabled={index === count - 1} onClick={() => move(1)} aria-label="Move down">↓</button>
    <button type="button" className="secondary danger" onClick={remove}>Remove</button>
  </div>;
}

function NumberSetting({ label, value, change }: { label: string; value?: number; change: (value: number | undefined) => void }) {
  return <label>{label}<input type="number" value={value ?? ""} onChange={(event) => change(event.target.value === "" ? undefined : Number(event.target.value))} /></label>;
}

function newQuestion(type: SurveyQuestionType): SurveyQuestion {
  const question: SurveyQuestion = {
    id: uniqueId("question"), type, label: "New question", helpText: "", required: false, width: "full", validation: {},
  };
  resetQuestionType(question, type);
  return question;
}

function resetQuestionType(question: SurveyQuestion, type: SurveyQuestionType) {
  question.type = type;
  question.options = type === "single_choice" || type === "multiple_choice"
    ? [{ id: "option_1", label: "Option 1" }, { id: "option_2", label: "Option 2" }] : undefined;
  question.rows = type === "rating_matrix"
    ? [{ id: "row_1", label: "Row 1" }, { id: "row_2", label: "Row 2" }] : undefined;
  question.scale = type === "rating_scale" || type === "rating_matrix"
    ? { min: 1, max: 5, minLabel: "Low", maxLabel: "High" } : undefined;
  question.validation = type === "file_upload"
    ? { maxSizeBytes: 10 * 1024 * 1024, allowedExtensions: ["pdf", "docx", "xlsx", "png", "jpg", "jpeg"] }
    : {};
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

function uniqueId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function optionId(label: string, index: number) {
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 70) || "option"}_${index + 1}`;
}

function lines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50);
}

function parseConditionValue(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function applyContextBinding(
  question: SurveyQuestion,
  binding: SurveyQuestion["contextBinding"] | "",
) {
  question.contextBinding = binding || undefined;
  if (!binding) return;
  question.required = false;
  if (["originalDueYear", "reportingYear", "publicationYear"].includes(binding)) {
    resetQuestionType(question, "number");
    question.validation = { min: 1000, max: 9999, step: 1 };
    return;
  }
  if (binding === "vertical" || binding === "smeClassification") {
    resetQuestionType(question, "single_choice");
    question.options = binding === "vertical"
      ? SURVEY_VERTICALS.map((label) => ({ id: label.replaceAll(" ", "_"), label }))
      : [{ id: "internal", label: "Internal" }, { id: "external", label: "External" }];
    return;
  }
  resetQuestionType(question, "short_text");
  question.validation = { maxLength: binding === "smeEmail" ? 320 : binding === "courseName" ? 1_000 : 200 };
}

function contextBindingLabel(binding: typeof CONTEXT_BINDINGS[number]) {
  const labels: Record<typeof CONTEXT_BINDINGS[number], string> = {
    smeName: "SME name",
    smeEmail: "SME email",
    smeClassification: "SME classification",
    respondentName: "Respondent / ID name",
    courseName: "Course name",
    reviewedSmeName: "Reviewed SME name",
    originalDueYear: "Original due year",
    reportingYear: "Reporting year",
    publicationYear: "Publication year",
    vertical: "Vertical",
  };
  return labels[binding];
}

function buttonLabel(key: string) {
  return key === "saveDraft" ? "Save draft label" : `${key[0].toUpperCase()}${key.slice(1)} label`;
}
