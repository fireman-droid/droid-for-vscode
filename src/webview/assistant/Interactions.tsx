import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  type AskUserAnswer,
  type AskUserInteractionRequest,
  type AskUserQuestion,
  type PermissionInteractionRequest,
} from '../../shared/bridgeMessages';
import { DroidMarkdownContent } from './MarkdownText';
import type { PendingInteraction } from './store';

interface InteractionPanelProps {
  readonly requests: readonly PendingInteraction[];
  readonly onPermissionRespond: (
    interaction: PendingInteraction,
    selectedOption: string,
    editedSpecContent?: string,
  ) => void;
  readonly onAskUserRespond: (
    interaction: PendingInteraction,
    cancelled: boolean,
    answers: readonly AskUserAnswer[],
  ) => void;
  readonly onPlanDocumentOpen?: (
    interaction: PendingInteraction,
  ) => void;
}

export const InteractionPanel = memo(function InteractionPanel({
  requests,
  onPermissionRespond,
  onAskUserRespond,
  onPlanDocumentOpen,
}: InteractionPanelProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLElement>(null);
  const active = requests[0];

  useEffect(() => {
    if (active !== undefined) {
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [active?.request.requestId]);

  if (active === undefined) {
    return null;
  }

  const queuedCount = requests.length - 1;
  return (
    <aside
      ref={panelRef}
      className={`dvx-interaction-panel dvx-interaction-panel-${active.request.kind}`}
      aria-label="Droid input request"
      tabIndex={-1}
    >
      {queuedCount > 0 ? (
        <div className="dvx-interaction-queue" aria-live="polite">
          {queuedCount} {queuedCount === 1 ? 'request' : 'requests'} queued
        </div>
      ) : null}
      {active.request.kind === 'permission' ? (
        <PermissionRequestCard
          key={active.request.requestId}
          request={active.request}
          planDocument={active.planDocument}
          {...(onPlanDocumentOpen === undefined ||
          active.request.editableSpecContent === undefined ||
          active.request.options.filter(
            ({ requiresEditedSpec }) => requiresEditedSpec,
          ).length !== 1
            ? {}
            : { onOpenPlanDocument: () => onPlanDocumentOpen(active) })}
          onRespond={(selectedOption, editedSpecContent) =>
            onPermissionRespond(
              active,
              selectedOption,
              editedSpecContent,
            )
          }
        />
      ) : (
        <AskUserRequestCard
          key={active.request.requestId}
          request={active.request}
          onRespond={(cancelled, answers) =>
            onAskUserRespond(active, cancelled, answers)
          }
        />
      )}
    </aside>
  );
});

export function PermissionRequestCard({
  request,
  planDocument,
  onOpenPlanDocument,
  onRespond,
}: {
  readonly request: PermissionInteractionRequest;
  readonly planDocument?: PendingInteraction['planDocument'];
  readonly onOpenPlanDocument?: () => void;
  readonly onRespond: (
    selectedOption: string,
    editedSpecContent?: string,
  ) => void;
}): React.JSX.Element {
  const titleId = useId();
  const editorId = useId();
  const [editOptionIndex, setEditOptionIndex] = useState<number | null>(null);
  const [editedSpecContent, setEditedSpecContent] = useState(
    request.editableSpecContent ?? '',
  );
  const [editPreview, setEditPreview] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [awaitingClose, setAwaitingClose] = useState(false);
  const awaitingCloseRef = useRef(false);
  const editOption =
    editOptionIndex === null ? undefined : request.options[editOptionIndex];
  const requestPresentation = getPermissionPresentation(request);
  const editedSpecTooLong =
    editedSpecContent.length > MAX_EDITED_SPEC_LENGTH;
  const planDocumentTooLong = planDocument?.status === 'too-large';
  const planContent =
    planDocument?.content ??
    requestPresentation.planPreview;
  const negativeOptions = request.options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => isNegativePermissionOption(option));
  const positiveOptions = request.options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => !isNegativePermissionOption(option));
  const respond = (
    selectedOption: string,
    nextEditedSpecContent?: string,
  ): void => {
    if (awaitingCloseRef.current) {
      return;
    }
    awaitingCloseRef.current = true;
    setAwaitingClose(true);
    onRespond(selectedOption, nextEditedSpecContent);
  };

  return (
    <section
      className={`dvx-interaction-card dvx-permission dvx-permission-${requestPresentation.kind}`}
      aria-labelledby={titleId}
      aria-busy={awaitingClose}
    >
      <header className="dvx-interaction-heading">
        {requestPresentation.kind === 'plan' &&
        onOpenPlanDocument !== undefined ? (
          <>
            <div className="dvx-plan-heading-meta">
              <span className="dvx-interaction-eyebrow">
                {requestPresentation.eyebrow}
              </span>
              <button
                type="button"
                className="dvx-plan-open-action"
                disabled={awaitingClose}
                onClick={onOpenPlanDocument}
              >
                Open in editor
              </button>
            </div>
            <h2 id={titleId}>{requestPresentation.title}</h2>
          </>
        ) : (
          <>
            <span className="dvx-interaction-eyebrow">
              {requestPresentation.eyebrow}
            </span>
            <h2 id={titleId}>{requestPresentation.title}</h2>
          </>
        )}
      </header>
      <div className="dvx-permission-tools">
        {request.tools.map((tool) => (
          <article
            className={`dvx-permission-tool dvx-permission-tool-${getToolTone(
              tool.confirmationKind,
            )}`}
            key={tool.toolUseId}
            aria-label={tool.toolName}
          >
            <div className="dvx-permission-tool-meta">
              <code>{tool.toolName}</code>
              <span>{formatConfirmationKind(tool.confirmationKind)}</span>
            </div>
            <strong>{tool.title}</strong>
            {tool.detail !== undefined ? (
              <pre>{tool.detail}</pre>
            ) : null}
            {tool.riskNote !== undefined ? (
              <p className="dvx-permission-risk">{tool.riskNote}</p>
            ) : null}
          </article>
        ))}
      </div>

      {requestPresentation.kind === 'plan' &&
      planContent !== undefined &&
      onOpenPlanDocument !== undefined ? (
        <>
          <div className="dvx-plan-preview">
            <DroidMarkdownContent
              className="dvx-plan-markdown"
              text={planContent}
            />
          </div>
          {planDocument?.status === 'too-large' ? (
            <p className="dvx-plan-document-status dvx-error-text" role="status">
              The edited plan is over the 262,144 character limit. Shorten it
              in the editor before approving.
            </p>
          ) : planDocument?.status === 'closed' ? (
            <p className="dvx-plan-document-status">
              Editor closed. Open it again to continue editing.
            </p>
          ) : planDocument?.status === 'failed' ? (
            <p className="dvx-plan-document-status dvx-error-text" role="status">
              Cursor could not open the plan document.
            </p>
          ) : null}
        </>
      ) : editOption !== undefined ? (
        <div className="dvx-permission-editor">
          <div className="dvx-permission-editor-heading">
            <label htmlFor={editorId}>{editOption.label}</label>
            <div
              className="dvx-editor-view-toggle"
              role="tablist"
              aria-label="Spec editor view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!editPreview}
                disabled={awaitingClose}
                onClick={() => setEditPreview(false)}
              >
                Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editPreview}
                disabled={awaitingClose}
                onClick={() => setEditPreview(true)}
              >
                Preview
              </button>
            </div>
          </div>
          {editPreview ? (
            <div className="dvx-plan-preview dvx-plan-edit-preview">
              <DroidMarkdownContent
                className="dvx-plan-markdown"
                text={editedSpecContent}
              />
            </div>
          ) : (
            <textarea
              id={editorId}
              value={editedSpecContent}
              rows={7}
              autoFocus
              disabled={awaitingClose}
              onChange={(event) =>
                setEditedSpecContent(event.currentTarget.value)
              }
            />
          )}
          <div
            className={`dvx-field-counter${
              editedSpecTooLong ? ' dvx-error-text' : ''
            }`}
            role={editedSpecTooLong ? 'status' : undefined}
          >
            {editedSpecContent.length.toLocaleString()} /{' '}
            {MAX_EDITED_SPEC_LENGTH.toLocaleString()}
          </div>
        </div>
      ) : requestPresentation.planPreview !== undefined ? (
        <>
          <div className="dvx-plan-preview">
            <DroidMarkdownContent
              className="dvx-plan-markdown"
              text={requestPresentation.planPreview}
            />
          </div>
        </>
      ) : null}

      <div className="dvx-interaction-actions">
        {editOption === undefined &&
        requestPresentation.kind === 'permission' &&
        positiveOptions.length > 0 ? (
          <>
            {negativeOptions.map(({ option, index }) => (
              <button
                className="dvx-button dvx-button-danger"
                type="button"
                key={index}
                disabled={awaitingClose}
                onClick={() => respond(option.value)}
              >
                {option.label}
              </button>
            ))}
            <PermissionAllowGroup
              options={positiveOptions}
              expanded={showMoreOptions}
              disabled={awaitingClose}
              onExpandedChange={setShowMoreOptions}
              onEdit={setEditOptionIndex}
              onRespond={respond}
            />
          </>
        ) : editOption === undefined &&
          requestPresentation.kind === 'plan' ? (
          <>
            {negativeOptions.map(({ option, index }) => (
              <button
                className="dvx-button dvx-button-danger"
                type="button"
                key={index}
                disabled={awaitingClose}
                onClick={() => respond(option.value)}
              >
                {option.label}
              </button>
            ))}
            {positiveOptions
              .filter(({ option }) => option.requiresEditedSpec)
              .map(({ option, index }) => (
                <button
                  className="dvx-button"
                  type="button"
                  key={index}
                  disabled={awaitingClose}
                  onClick={() => {
                    if (onOpenPlanDocument === undefined) {
                      setEditOptionIndex(index);
                    } else {
                      onOpenPlanDocument();
                    }
                  }}
                >
                  {option.label}
                </button>
              ))}
            <PermissionAllowGroup
              options={positiveOptions.filter(
                ({ option }) => !option.requiresEditedSpec,
              )}
              expanded={showMoreOptions}
              disabled={awaitingClose || planDocumentTooLong}
              primaryLabel="Approve plan"
              menuLabel="More plan approval options"
              onExpandedChange={setShowMoreOptions}
              onEdit={setEditOptionIndex}
              onRespond={respond}
            />
          </>
        ) : editOption !== undefined ? (
          <>
            {negativeOptions.map(({ option, index }) => (
              <button
                className="dvx-button dvx-button-danger"
                type="button"
                key={index}
                disabled={awaitingClose}
                onClick={() => respond(option.value)}
              >
                {option.label}
              </button>
            ))}
            <button
              className="dvx-button dvx-button-primary"
              type="button"
              disabled={awaitingClose || editedSpecTooLong}
              onClick={() => respond(editOption.value, editedSpecContent)}
            >
              {editOption.label}
            </button>
          </>
        ) : (
          request.options.map((option, optionIndex) =>
            <button
              className={`dvx-button${
                isNegativePermissionOption(option)
                  ? ' dvx-button-danger'
                  : option.requiresEditedSpec
                    ? ''
                    : ' dvx-button-primary'
              }`}
              type="button"
              key={optionIndex}
              disabled={awaitingClose}
              aria-pressed={
                option.requiresEditedSpec
                  ? editOptionIndex === optionIndex
                  : undefined
              }
              onClick={() => {
                if (option.requiresEditedSpec) {
                  setEditOptionIndex(optionIndex);
                  return;
                }
                respond(option.value);
              }}
            >
              {option.label}
            </button>
          )
        )}
      </div>
    </section>
  );
}

interface IndexedPermissionOption {
  readonly option: PermissionInteractionRequest['options'][number];
  readonly index: number;
}

function PermissionAllowGroup({
  options,
  expanded,
  disabled,
  primaryLabel,
  menuLabel = 'More permission options',
  onExpandedChange,
  onEdit,
  onRespond,
}: {
  readonly options: readonly IndexedPermissionOption[];
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly primaryLabel?: string;
  readonly menuLabel?: string;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onEdit: (index: number) => void;
  readonly onRespond: (value: string) => void;
}): React.JSX.Element | null {
  const primary = options[0];
  if (primary === undefined) {
    return null;
  }

  const select = ({ option, index }: IndexedPermissionOption): void => {
    onExpandedChange(false);
    if (option.requiresEditedSpec) {
      onEdit(index);
      return;
    }
    onRespond(option.value);
  };

  return (
    <div className="dvx-permission-allow-group">
      <button
        className="dvx-button dvx-button-primary dvx-permission-primary"
        type="button"
        disabled={disabled}
        onClick={() => select(primary)}
      >
        {primaryLabel ?? primary.option.label}
      </button>
      {options.length > 1 ? (
        <>
          <button
            className="dvx-button dvx-button-primary dvx-permission-more"
            type="button"
            aria-label={menuLabel}
            aria-expanded={expanded}
            disabled={disabled}
            onClick={() => onExpandedChange(!expanded)}
          >
            <PermissionMenuChevron />
          </button>
          {expanded ? (
            <div className="dvx-permission-menu" role="menu">
              {options.slice(1).map((option) => (
                <button
                  type="button"
                  role="menuitem"
                  key={option.index}
                  disabled={disabled}
                  onClick={() => select(option)}
                >
                  {option.option.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PermissionMenuChevron(): React.JSX.Element {
  return (
    <svg
      className="dvx-permission-chevron"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4.25 8.25 2.75-2.75 2.75 2.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface QuestionAnswer {
  readonly selected: readonly number[];
  readonly custom: string;
}

export function AskUserRequestCard({
  request,
  onRespond,
}: {
  readonly request: AskUserInteractionRequest;
  readonly onRespond: (
    cancelled: boolean,
    answers: readonly AskUserAnswer[],
  ) => void;
}): React.JSX.Element {
  const titleId = useId();
  const inputIdBase = useId();
  const [answers, setAnswers] = useState<readonly QuestionAnswer[]>(() =>
    request.questions.map(() => ({ selected: [], custom: '' })),
  );
  const [awaitingClose, setAwaitingClose] = useState(false);
  const awaitingCloseRef = useRef(false);
  const presentations = request.questions.map(presentAskUserQuestion);
  const resolvedAnswers = request.questions.map((question, position) => ({
    index: question.index,
    answer: resolveAnswer(presentations[position], answers[position]),
  }));
  const hasOversizedAnswer = resolvedAnswers.some(
    ({ answer }) => answer.length > MAX_ASK_USER_ANSWER_LENGTH,
  );
  const canSubmit =
    !hasOversizedAnswer &&
    resolvedAnswers.every(({ answer }) => answer.length > 0);

  const updateAnswer = (
    position: number,
    update: (answer: QuestionAnswer) => QuestionAnswer,
  ): void => {
    setAnswers((current) =>
      current.map((answer, index) =>
        index === position ? update(answer) : answer,
      ),
    );
  };

  const respond = (
    cancelled: boolean,
    nextAnswers: readonly AskUserAnswer[],
  ): void => {
    if (awaitingCloseRef.current) {
      return;
    }
    awaitingCloseRef.current = true;
    setAwaitingClose(true);
    onRespond(cancelled, nextAnswers);
  };

  return (
    <section
      className="dvx-interaction-card dvx-ask-user"
      aria-labelledby={titleId}
      aria-busy={awaitingClose}
    >
      <header className="dvx-interaction-heading">
        <span className="dvx-interaction-eyebrow">AskUser</span>
        <h2 id={titleId}>
          Droid has {request.questions.length}{' '}
          {request.questions.length === 1 ? 'question' : 'questions'} for you
        </h2>
      </header>
      <div className="dvx-ask-questions">
        {request.questions.map((question, position) => {
          const answer = answers[position];
          const presentation = presentations[position]!;
          const customId = `${inputIdBase}-custom-${position}`;
          const answerKind =
            presentation.options.length === 0
              ? 'open response'
              : presentation.multiSelect
                ? 'multiple choice'
                : 'single choice';
          return (
            <fieldset key={position} disabled={awaitingClose}>
              <legend>
                <span className="dvx-question-topic">
                  {question.topic || `Question ${position + 1}`} ·{' '}
                  {answerKind}
                </span>
                <span className="dvx-question-text">
                  {presentation.question}
                </span>
              </legend>
              <div className="dvx-question-options">
                {presentation.options.map((option, optionIndex) => {
                  const inputId =
                    `${inputIdBase}-option-${position}-${optionIndex}`;
                  const checked =
                    answer?.selected.includes(optionIndex) ?? false;
                  return (
                    <label htmlFor={inputId} key={optionIndex}>
                      <input
                        className={
                          presentation.multiSelect
                            ? undefined
                            : 'dvx-question-radio'
                        }
                        id={inputId}
                        type={
                          presentation.multiSelect ? 'checkbox' : 'radio'
                        }
                        name={`${inputIdBase}-question-${position}`}
                        value={option}
                        checked={checked}
                        onChange={() =>
                          updateAnswer(position, (current) => ({
                            ...current,
                            selected: presentation.multiSelect
                              ? checked
                                ? current.selected.filter(
                                    (value) => value !== optionIndex,
                                  )
                                : [...current.selected, optionIndex]
                              : [optionIndex],
                          }))
                        }
                      />
                      {presentation.multiSelect ? null : (
                        <span
                          className="dvx-question-radio-mark"
                          aria-hidden="true"
                        />
                      )}
                      <span className="dvx-question-option-text">
                        {option}
                      </span>
                    </label>
                  );
                })}
              </div>
              <label
                className="dvx-visually-hidden"
                htmlFor={customId}
              >
                Your own answer
              </label>
              <input
                id={customId}
                type="text"
                placeholder={
                  presentation.options.length === 0
                    ? 'Enter your answer…'
                    : 'Or enter a custom answer…'
                }
                value={answer?.custom ?? ''}
                maxLength={MAX_ASK_USER_ANSWER_LENGTH}
                onChange={(event) => {
                  const custom = event.currentTarget.value;
                  updateAnswer(position, (current) => ({
                    ...current,
                    custom,
                  }));
                }}
              />
            </fieldset>
          );
        })}
      </div>

      {hasOversizedAnswer ? (
        <p className="dvx-form-error" role="status" aria-live="polite">
          An answer is too long. Choose fewer options or shorten your answer.
        </p>
      ) : null}
      <div className="dvx-interaction-actions">
        <button
          className="dvx-button"
          type="button"
          disabled={awaitingClose}
          onClick={() => respond(true, [])}
        >
          Cancel
        </button>
        <button
          className="dvx-button dvx-button-primary"
          type="button"
          disabled={!canSubmit || awaitingClose}
          onClick={() => respond(false, resolvedAnswers)}
        >
          Submit answers
        </button>
      </div>
    </section>
  );
}

function resolveAnswer(
  question: AskUserQuestionPresentation | undefined,
  answer: QuestionAnswer | undefined,
): string {
  if (question === undefined || answer === undefined) {
    return '';
  }
  const custom = answer.custom.trim();
  if (!question.multiSelect) {
    const selectedIndex = answer.selected[0];
    return custom.length > 0
      ? custom
      : selectedIndex === undefined
        ? ''
        : (question.options[selectedIndex] ?? '');
  }
  const selectedLabels = question.options.filter((_, optionIndex) =>
    answer.selected.includes(optionIndex),
  );
  return [
    ...selectedLabels,
    ...(custom.length > 0 ? [custom] : []),
  ].join(', ');
}

interface AskUserQuestionPresentation {
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

function presentAskUserQuestion(
  question: AskUserQuestion,
): AskUserQuestionPresentation {
  const embeddedQuestionnaire = formatEmbeddedQuestionnaire(
    question.question,
  );
  if (embeddedQuestionnaire !== null) {
    return {
      question: embeddedQuestionnaire,
      options: [],
      multiSelect: false,
    };
  }
  return {
    question: question.question,
    options: question.options,
    multiSelect: question.multiSelect,
  };
}

function formatEmbeddedQuestionnaire(text: string): string | null {
  const decoded = text.replaceAll('\\n', '\n');
  if (
    !/\[topic\]/iu.test(decoded) ||
    !/\[option\]/iu.test(decoded)
  ) {
    return null;
  }
  return decoded
    .replace(
      /(?:^|\n)\s*(\d+\.)?\s*\[question\]\s*/giu,
      (_, number: string | undefined) =>
        `\n\n${number === undefined ? '' : `${number} `}`,
    )
    .replace(/\s*\[topic\]\s*/giu, '\nTopic: ')
    .replace(/\s*\[option\]\s*/giu, '\n• ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function formatConfirmationKind(value: string): string {
  return value.replaceAll('_', ' ');
}

function getToolTone(value: string): 'edit' | 'execute' | 'danger' {
  if (/exec|shell/i.test(value)) {
    return 'execute';
  }
  if (/sandbox|mission/i.test(value)) {
    return 'danger';
  }
  return 'edit';
}

function isNegativePermissionOption(
  option: PermissionInteractionRequest['options'][number],
): boolean {
  return /cancel|deny|reject/i.test(`${option.value} ${option.label}`);
}

function getPermissionPresentation(
  request: PermissionInteractionRequest,
): {
  readonly kind: 'permission' | 'plan' | 'mission';
  readonly eyebrow: string;
  readonly title: string;
  readonly planPreview?: string;
} {
  const kinds = new Set(request.tools.map((tool) => tool.confirmationKind));
  if (kinds.has('exit_spec_mode')) {
    return {
      kind: 'plan',
      eyebrow: 'Implementation plan · ExitSpecMode',
      title: 'Droid has completed planning and is ready to implement',
      ...(request.editableSpecContent === undefined
        ? {}
        : { planPreview: request.editableSpecContent }),
    };
  }
  if (
    kinds.has('propose_mission') ||
    kinds.has('start_mission_run')
  ) {
    return {
      kind: 'mission',
      eyebrow: `Mission · ${formatConfirmationKind(
        request.tools[0]?.confirmationKind ?? 'confirmation',
      )}`,
      title: request.tools[0]?.title ?? 'Mission confirmation',
    };
  }
  return {
    kind: 'permission',
    eyebrow: 'Permission request',
    title: `Droid requests ${request.tools.length} ${
      request.tools.length === 1 ? 'action' : 'actions'
    }`,
  };
}
