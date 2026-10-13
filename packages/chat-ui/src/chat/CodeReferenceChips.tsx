import { FileCode2, X } from 'lucide-react';
import { useUiEnvironment } from '../environment';
import { useI18n } from '../i18n';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { parseCodeReferences, type CodeReference } from './codeReferences';

export function CodeReferenceChips({ references, onRemove, className }: {
  references: readonly CodeReference[]; onRemove?: (index: number) => void; className?: string;
}) {
  const { openCodeReference, codeReferenceAction } = useUiEnvironment();
  const { t } = useI18n();
  if (!references.length) return null;
  return <span className={cn('dvx-code-references', className)}>
    {references.map((reference, index) => {
      const name = reference.path.split(/[\\/]/).at(-1);
      const range = reference.startLine === reference.endLine ? `${reference.startLine}` : `${reference.startLine}–${reference.endLine}`;
      const label = `${name} (${range})`;
      return <span key={index} className="dvx-code-reference">
        <Button variant="plain" size="none" disabled={!openCodeReference} title={`${reference.path}:${range}${reference.side ? ` · ${t(reference.side === 'before' ? 'Before' : 'After')}` : ''}`}
          aria-label={t(codeReferenceAction === 'reveal' ? 'Reveal {p0}' : 'Open {p0}', { p0: label })} onClick={() => openCodeReference?.(reference)}
          className="inline-flex h-full min-w-0 items-center gap-1 px-1 text-left text-[11px] hover:underline focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
          <FileCode2 className="size-3 shrink-0" aria-hidden /><span className="truncate">{label}</span>
        </Button>
        {onRemove ? <Button variant="plain" size="none" aria-label={t('Remove {p0}', { p0: label })} onClick={() => onRemove(index)}
          className="grid size-5 shrink-0 place-items-center rounded-md hover:bg-[var(--control-surface)] focus-visible:ring-1 focus-visible:ring-ring"><X className="size-3" aria-hidden /></Button> : null}
      </span>;
    })}
  </span>;
}

export function ReferencedText({ text }: { text: string }) {
  const { references, inline, tokens } = parseCodeReferences(text);
  const parts = inline.split(/([\ue000-\uf8ff])/);
  return <span className="whitespace-pre-wrap">{parts.map((part, index) => {
    const position = tokens.indexOf(part);
    return position >= 0 ? <CodeReferenceChips key={index} references={[references[position]!]} /> : part;
  })}</span>;
}
