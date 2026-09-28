// Keep previous editor-assistance requests out of chat history after removing the feature.
export const EDITOR_ASSISTANCE_SESSION_TAG = 'droid-editor-assistance';

export function isEditorAssistanceSession(
  tags: readonly { readonly name: string }[] | undefined,
): boolean {
  return tags?.some((tag) => tag.name === EDITOR_ASSISTANCE_SESSION_TAG) === true;
}
