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
}

export const InteractionPanel = memo(function InteractionPanel({
  requests,
  onPermissionRespond,
  onAskUserRespond,
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
      className="dvx-interaction-panel"
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
  onRespond,
}: {
  readonly request: PermissionInteractionRequest;
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
  const [awaitingClose, setAwaitingClose] = useState(false);
  const awaitingCloseRef = useRef(false);
  const editOption =
    editOptionIndex === null ? undefined : request.options[editOptionIndex];
  const editedSpecTooLong =
    editedSpecContent.length > MAX_EDITED_SPEC_LENGTH;

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
      className="dvx-interaction-card dvx-permission"
      aria-labelledby={titleId}
      aria-busy={awaitingClose}
    >
      <header className="dvx-interaction-heading">
        <span className="dvx-interaction-eyebrow">Permission required</span>
        <h2 id={titleId}>Droid wants to continue</h2>
      </header>
      <div className="dvx-permission-tools">
        {request.tools.map((tool) => (
          <article
            className="dvx-permission-tool"
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

      {editOption !== undefined ? (
        <div className="dvx-permission-editor">
          <label htmlFor={editorId}>{editOption.label}</label>
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
          <div
            className={`dvx-field-counter${
              editedSpecTooLong ? ' dvx-error-text' : ''
            }`}
            role={editedSpecTooLong ? 'status' : undefined}
          >
            {editedSpecContent.length.toLocaleString()} /{' '}
            {MAX_EDITED_SPEC_LENGTH.toLocaleString()}
          </div>
          <button
            className="dvx-button dvx-button-primary"
            type="button"
            disabled={awaitingClose || editedSpecTooLong}
            onClick={() => respond(editOption.value, editedSpecContent)}
          >
            {editOption.label}
          </button>
        </div>
      ) : null}

      <div className="dvx-interaction-actions">
        {request.options.map((option, optionIndex) => (
          <button
            className="dvx-button"
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
        ))}
      </div>
    </section>
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
  const resolvedAnswers = request.questions.map((question, position) => ({
    index: question.index,
    answer: resolveAnswer(question, answers[position]),
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
        <span className="dvx-interaction-eyebrow">
          Droid has a question
        </span>
        <h2 id={titleId}>Choose how to proceed</h2>
      </header>
      <div className="dvx-ask-questions">
        {request.questions.map((question, position) => {
          const answer = answers[position];
          const customId = `${inputIdBase}-custom-${position}`;
          return (
            <fieldset key={position} disabled={awaitingClose}>
              <legend>
                {question.topic.length > 0 ? (
                  <span className="dvx-question-topic">
                    {question.topic}
                  </span>
                ) : null}
                <span>{question.question}</span>
              </legend>
              <div className="dvx-question-options">
                {question.options.map((option, optionIndex) => {
                  const inputId =
                    `${inputIdBase}-option-${position}-${optionIndex}`;
                  const checked =
                    answer?.selected.includes(optionIndex) ?? false;
                  return (
                    <label htmlFor={inputId} key={optionIndex}>
                      <input
                        id={inputId}
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        name={`${inputIdBase}-question-${position}`}
                        value={option}
                        checked={checked}
                        onChange={() =>
                          updateAnswer(position, (current) => ({
                            ...current,
                            selected: question.multiSelect
                              ? checked
                                ? current.selected.filter(
                                    (value) => value !== optionIndex,
                                  )
                                : [...current.selected, optionIndex]
                              : [optionIndex],
                          }))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
              <label className="dvx-custom-label" htmlFor={customId}>
                Your own answer
              </label>
              <input
                id={customId}
                type="text"
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
  question: AskUserQuestion,
  answer: QuestionAnswer | undefined,
): string {
  if (answer === undefined) {
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

function formatConfirmationKind(value: string): string {
  return value.replaceAll('_', ' ');
}
