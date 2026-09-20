import { useEffect, useRef, useState } from 'react';
import type { PendingInteraction } from '../../webview/assistant/interactions/interactionStore';
import type { AskUserQuestion, PermissionInteractionRequest } from '../../shared/protocol/interactions';
import { MAX_ASK_USER_ANSWER_LENGTH, MAX_EDITED_SPEC_LENGTH, type AskUserAnswer } from '../../shared/protocol/interactionProtocol';
import { Button } from '../ui/button';
import { Input, Textarea } from '../ui/input';
import { Checkbox } from '../ui/selection';
import { RadioGroup, RadioGroupItem, ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { presentAskUserQuestion, resolveAnswer } from '../../webview/assistant/interactions/questionAnswers';
import { getPermissionPresentation, isNegativePermissionOption } from '../../webview/assistant/interactions/permissionPresentation';
import { Markdown } from '../content/Markdown';
import { PermissionOptions } from './PermissionOptions';

export interface InteractionActions {
  readonly onPermission: (interaction: PendingInteraction, option: string, edited?: string) => void;
  readonly onAnswer: (interaction: PendingInteraction, cancelled: boolean, answers: readonly AskUserAnswer[]) => void;
  readonly onOpenPlan: (interaction: PendingInteraction) => void;
}

export function InteractionPanel({ requests, actions }: { readonly requests: readonly PendingInteraction[]; readonly actions: InteractionActions }) {
  const active = requests[0];
  const root = useRef<HTMLElement>(null);
  useEffect(() => { if (active) root.current?.focus({ preventScroll: true }); }, [active?.request.requestId]);
  if (!active) return null;
  return (
    <aside ref={root} tabIndex={-1} aria-label="Droid input request" className="flex max-h-[min(52vh,520px)] min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--panel-edge)] bg-input-background px-3 pt-[11px] outline-none">
      {requests.length > 1 ? <p className="mb-2 text-xs text-muted-foreground">{requests.length - 1} requests queued</p> : null}
      {active.request.kind === 'permission'
        ? <PermissionCard key={active.request.requestId} interaction={active} request={active.request} actions={actions} />
        : <Questionnaire key={active.request.requestId} interaction={active} questions={active.request.questions} actions={actions} />}
    </aside>
  );
}

function PermissionCard({ request, interaction, actions }: {
  readonly request: PermissionInteractionRequest;
  readonly interaction: PendingInteraction;
  readonly actions: InteractionActions;
}) {
  const [waiting, setWaiting] = useState(false);
  const sent = useRef(false);
  const [editingOption, setEditingOption] = useState<string | null>(null);
  const [draft, setDraft] = useState(request.editableSpecContent ?? '');
  const [preview, setPreview] = useState(false);
  const presentation = getPermissionPresentation(request);
  const plan = interaction.planDocument;
  const canOpenPlan = request.editableSpecContent !== undefined && request.options.filter((option) => option.requiresEditedSpec).length === 1;
  const respond = (value: string, content?: string) => {
    if (sent.current) return;
    sent.current = true;
    setWaiting(true);
    actions.onPermission(interaction, value, content);
  };
  return (
    <section aria-busy={waiting} className="flex min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>{presentation.kind === 'permission' ? null : <p className="text-[10px] text-muted-foreground">{presentation.eyebrow}</p>}<h2 className="text-[14px] font-semibold leading-[21px]">{presentation.title}</h2></div>
        {canOpenPlan ? <Button variant="link" size="sm" disabled={waiting} onClick={() => actions.onOpenPlan(interaction)}>Open in editor</Button> : null}
      </div>
      <div className="min-h-0 overflow-y-auto">{request.tools.map((tool) => (
        <article key={tool.toolUseId} aria-label={tool.toolName} className="space-y-1 border-b border-[var(--panel-edge)] py-3 last:border-0">
          <p className="text-[10.5px] text-muted-foreground">{presentation.kind === 'permission' ? '' : `${tool.toolName} · `}{tool.confirmationKind.replaceAll('_', ' ')}</p>
          <h3 className="text-[13px]">{tool.title}</h3>
          {tool.detail ? <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[18px]">{tool.detail}</pre> : null}
          {tool.riskNote ? <p className="text-xs text-destructive">{tool.riskNote}</p> : null}
        </article>
      ))}</div>
      {editingOption === null && (plan?.content ?? presentation.planPreview) ? <div className="max-h-[min(30vh,260px)] min-h-0 overflow-auto px-0.5 py-1"><Markdown text={(plan?.content ?? presentation.planPreview)!} /></div> : null}
      {plan?.status === 'too-large' ? <p role="alert" className="text-xs text-destructive">Shorten the edited plan in Cursor before approving.</p> : null}
      {plan?.status === 'failed' ? <p role="alert" className="text-xs text-destructive">The plan document could not be opened.</p> : null}
      {plan?.status === 'closed' ? <p className="text-xs text-muted-foreground">Plan editor closed. Open it again to continue editing.</p> : null}
      {editingOption === null ? null : (
        <div className="space-y-2">
          <ToggleGroup type="single" value={preview ? 'preview' : 'edit'} onValueChange={(value) => { if (value) setPreview(value === 'preview'); }} className="flex gap-1" aria-label="Plan view">
            <ToggleGroupItem value="edit">Edit</ToggleGroupItem><ToggleGroupItem value="preview">Preview</ToggleGroupItem>
          </ToggleGroup>
          {preview ? <div className="max-h-64 overflow-auto"><Markdown text={draft} /></div> : <Textarea aria-label="Edit plan" value={draft} onChange={(event) => setDraft(event.target.value)} rows={8} disabled={waiting} maxLength={MAX_EDITED_SPEC_LENGTH} />}
          <p className="text-[10px] text-muted-foreground">{draft.length.toLocaleString()} / {MAX_EDITED_SPEC_LENGTH.toLocaleString()}</p>
          <div className="flex gap-2">
            <Button disabled={waiting || !draft.trim() || draft.length > MAX_EDITED_SPEC_LENGTH} onClick={() => respond(editingOption, draft)}>Submit edited plan</Button>
            <Button variant="ghost" disabled={waiting} onClick={() => setEditingOption(null)}>Cancel edit</Button>
          </div>
        </div>
      )}
      <div className="shrink-0 border-t border-[var(--panel-edge)] pt-2 pb-[9px]"><PermissionOptions options={request.options} plan={presentation.kind === 'plan'}
        disabled={(option) => waiting || (presentation.kind === 'plan' && plan?.status === 'too-large' && !isNegativePermissionOption(option)) || (option.requiresEditedSpec && (plan?.status === 'too-large' || request.editableSpecContent === undefined))}
        onSelect={(option) => {
              if (!option.requiresEditedSpec) respond(option.value);
              else if (canOpenPlan) {
                if (plan?.status === 'ready' && plan.content !== undefined) respond(option.value, plan.content);
                else actions.onOpenPlan(interaction);
              } else setEditingOption(option.value);
        }} /></div>
      {waiting ? <p role="status" className="text-xs text-muted-foreground">Waiting for Droid to confirm…</p> : null}
    </section>
  );
}

function Questionnaire({ interaction, questions, actions }: {
  readonly interaction: PendingInteraction;
  readonly questions: readonly AskUserQuestion[];
  readonly actions: InteractionActions;
}) {
  const [selected, setSelected] = useState<Record<number, readonly number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [waiting, setWaiting] = useState(false);
  const sent = useRef(false);
  const displayed = questions.map((question) => ({ ...question, ...presentAskUserQuestion(question) }));
  const answers = displayed.map((question) => ({
    index: question.index,
    answer: resolveAnswer(question, { selected: selected[question.index] ?? [], custom: custom[question.index] ?? '' }),
  }));
  const respond = (cancelled: boolean) => {
    if (sent.current) return;
    sent.current = true;
    setWaiting(true);
    actions.onAnswer(interaction, cancelled, cancelled ? [] : answers);
  };
  return (
    <form aria-busy={waiting} className="flex min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); respond(false); }}>
      <header className="shrink-0"><p className="text-[10px] text-muted-foreground">AskUser</p><h2 className="text-[14px] font-semibold leading-[21px]">Droid has {questions.length} {questions.length === 1 ? 'question' : 'questions'} for you</h2></header>
      <div className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      {displayed.map((question) => (
        <fieldset key={question.index} disabled={waiting} className="space-y-1.5 py-[13px]">
          <legend className="pt-3 text-[13px]"><span className="block text-[10.5px] text-muted-foreground">{question.topic || `Question ${question.index + 1}`} · {question.options.length === 0 ? 'open response' : question.multiSelect ? 'multiple choice' : 'single choice'}</span><span>{question.question}</span></legend>
          <QuestionOptions question={question} selected={selected[question.index] ?? []} disabled={waiting}
            onChange={(values) => setSelected((previous) => ({ ...previous, [question.index]: values }))} />
          <Input aria-label={`Own answer for ${question.topic}`} placeholder={question.options.length ? 'Or enter a custom answer…' : 'Enter your answer…'} maxLength={MAX_ASK_USER_ANSWER_LENGTH} value={custom[question.index] ?? ''} onChange={(event) => setCustom((previous) => ({ ...previous, [question.index]: event.target.value }))} />
        </fieldset>
      ))}</div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--panel-edge)] pt-2 pb-[9px]">
        <Button variant="outline" size="sm" disabled={waiting} onClick={() => respond(true)}>Cancel</Button>
        <Button type="submit" size="sm" disabled={waiting || answers.some((answer) => !answer.answer || answer.answer.length > MAX_ASK_USER_ANSWER_LENGTH)}>Submit answers</Button>
      </div>
      {answers.some((answer) => answer.answer.length > MAX_ASK_USER_ANSWER_LENGTH) ? <p role="alert" className="text-xs text-destructive">An answer is too long. Choose fewer options or shorten your answer.</p> : null}
      {waiting ? <p role="status" className="text-xs text-muted-foreground">Waiting for Droid to confirm…</p> : null}
    </form>
  );
}

function QuestionOptions({ question, selected, disabled, onChange }: {
  question: AskUserQuestion; selected: readonly number[]; disabled: boolean; onChange(values: readonly number[]): void;
}) {
  const options = question.options.map((option, index) => <label key={option}
    className="v2-chat-choice v2-question-option flex min-h-9 items-start gap-2 rounded-lg border border-transparent px-[9px] py-[7px] text-xs">
    {question.multiSelect ? <Checkbox className="mt-0.5" disabled={disabled} checked={selected.includes(index)}
      onCheckedChange={(checked) => onChange(checked === true ? [...selected, index] : selected.filter((value) => value !== index))} />
      : <RadioGroupItem className="mt-0.5" value={String(index)} />}
    <span className="min-w-0 whitespace-pre-wrap">{option}</span>
  </label>);
  return question.multiSelect ? <div className="grid gap-1">{options}</div>
    : <RadioGroup aria-label={question.question} name={`question-${question.index}`} disabled={disabled}
      value={selected[0] === undefined ? '' : String(selected[0])} onValueChange={(value) => onChange([Number(value)])}>{options}</RadioGroup>;
}
