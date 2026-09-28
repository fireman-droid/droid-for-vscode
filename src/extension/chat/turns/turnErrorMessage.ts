import { scrubCredentials } from '../../diagnostics/LocalDiagnostics';
import { stripTerminalNoise } from '../../../shared/transcript/toolOutput';

/** Display the SDK message field, without serializing the surrounding error object. */
export function formatTurnErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const text = scrubCredentials(stripTerminalNoise(message)).trim();
  if (!text) return undefined;
  const limit = 2_000;
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
