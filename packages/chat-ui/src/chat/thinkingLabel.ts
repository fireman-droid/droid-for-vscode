import { translate, type TranslationParams } from '../i18n/translate';

// Completed Thinking rows read as a past-tense fact, mirroring the
// Cursor "Thought for Xs" affordance; sub-500ms runs are too short
// for a number to be meaningful.
export function formatThinkingLabel(
  statusType: string | undefined,
  durationMs: number | null,
  t: (message: string, params?: TranslationParams) => string = (message, params) => translate('en', message, params),
): string {
  if (statusType === 'incomplete') {
    return t('Thinking stopped');
  }
  if (durationMs === null) {
    return t('Thought');
  }
  if (durationMs < 500) {
    return t('Thought briefly');
  }
  if (durationMs < 1_000) {
    return t('Thought for {seconds}s', { seconds: (durationMs / 1_000).toFixed(1) });
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) {
    return t('Thought for {seconds}s', { seconds: totalSeconds });
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0
    ? t('Thought for {minutes}m', { minutes })
    : t('Thought for {minutes}m {seconds}s', { minutes, seconds });
}
