import { Message, MessageContent } from '../ai-elements/message';
import { Markdown } from '../content/Markdown';

/** The same response typography and Markdown behavior on every chat surface. */
export function AssistantMessage({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }) {
  return <Message from="assistant" className="v2-assistant-message"><MessageContent><Markdown text={text} streaming={streaming} /></MessageContent></Message>;
}
