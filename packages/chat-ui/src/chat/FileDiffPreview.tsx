import { useLayoutEffect, useMemo, useRef } from 'react';
import { ChevronUp, Ellipsis } from 'lucide-react';
import { useI18n } from '../i18n';
import { DiffView } from '../review/DiffView';
import { inlineDiffLines } from '../review/inlineDiffLines';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { useProcessDisclosure } from './processPresentation';

// One hunk heading and approximately nine source lines stay visible in chat.
const PREVIEW_LINES = 10;

export function FileDiffPreview({ patch, path, messageId = '', disclosureKey, onInteract }: {
  readonly patch: string;
  readonly path: string;
  readonly messageId?: string;
  readonly disclosureKey?: string;
  readonly onInteract?: () => void;
}) {
  const { t } = useI18n();
  const disclosure = useProcessDisclosure(messageId, disclosureKey);
  const shortened = useMemo(() => inlineDiffLines(patch).length > PREVIEW_LINES, [patch]);
  const collapsing = useRef(false);
  useLayoutEffect(() => {
    if (!collapsing.current) return;
    collapsing.current = false;
    disclosure.buttonRef.current?.scrollIntoView({ block: 'nearest' });
  }, [disclosure.expanded, disclosure.buttonRef]);
  if (!shortened) return <DiffView patch={patch} path={path} />;
  return <Collapsible className="dvx-file-diff-preview" open={disclosure.expanded} onOpenChange={() => {
    onInteract?.();
    collapsing.current = disclosure.expanded;
    disclosure.toggle();
  }}>
    {!disclosure.expanded ? <DiffView patch={patch} path={path} limit={PREVIEW_LINES} /> : null}
    <CollapsibleContent><DiffView patch={patch} path={path} /></CollapsibleContent>
    <CollapsibleTrigger asChild>
      <Button ref={disclosure.buttonRef} variant="plain" size="none" className="dvx-change-more dvx-diff-preview-toggle"
        aria-label={t(disclosure.expanded ? 'Collapse changes to {path}' : 'Show all changes to {path}', { path })}>
        {disclosure.expanded ? <ChevronUp aria-hidden="true" /> : <Ellipsis aria-hidden="true" />}
        <span>{t(disclosure.expanded ? 'Collapse changes' : 'Show all changes')}</span>
      </Button>
    </CollapsibleTrigger>
  </Collapsible>;
}
