import { InlineInput, type InlineInputProps } from '../ui/inline-input';
import { CodeReferenceChips } from './CodeReferenceChips';
import type { useCodeReferenceDraft } from './useCodeReferenceDraft';

export function CodeReferenceInput({ draft, onPaste, onKeyDown, onChange, ...props }: Omit<InlineInputProps, 'tokens' | 'renderToken' | 'value' | 'onChange'> & {
  draft: ReturnType<typeof useCodeReferenceDraft>;
  onChange?: InlineInputProps['onChange'];
}) {
  return <InlineInput {...props} value={draft.body} tokens={draft.tokens} maxLength={draft.maxLength} measureText={draft.measureText}
    renderToken={token => <CodeReferenceChips references={[draft.references[draft.tokens.indexOf(token)]!]} />}
    onChange={onChange ?? draft.change}
    onCopy={draft.onCopy}
    onPaste={(event, input) => { if (!draft.onPaste(event, input)) onPaste?.(event, input); }}
    onKeyDown={event => { draft.onKeyDown(event); if (!event.defaultPrevented) onKeyDown?.(event); }} />;
}
