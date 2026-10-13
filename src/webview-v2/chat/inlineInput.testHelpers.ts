import { fireEvent } from '@testing-library/react';
import { inlineText, setInlineSelection } from '../../../packages/chat-ui/src/ui/inlineInputDom';

export { inlineText, setInlineSelection };
export function inputText(element: HTMLElement, value: string) {
  element.focus(); element.textContent = value;
  setInlineSelection(element, value.length);
  fireEvent.input(element, { inputType: 'insertText' });
}
export function pasteText(element: HTMLElement, text: string) {
  fireEvent.paste(element, { clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? text : '' } });
}
