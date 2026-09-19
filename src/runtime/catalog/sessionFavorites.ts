import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Reads and writes the droid CLI's private `.favorites` file
 * (`~/.factory/sessions/.favorites`, a JSON string[] of session ids).
 *
 * This is deliberately a private-file contract, not an official API:
 * the SDK only exposes reading (`listSessions().isFavorite`), and the
 * file is owned by the droid CLI TUI. Writes therefore stay minimal
 * (only add or remove the one session id the user toggled), use an
 * atomic rename, and fail closed: any unexpected file shape or IO
 * error leaves the file untouched and reports `false`.
 */

const FAVORITES_FILE_NAME = '.favorites';

export function defaultSessionsDirectory(): string {
  return path.join(os.homedir(), '.factory', 'sessions');
}

export async function readFavorites(
  sessionsDirectory: string,
): Promise<ReadonlySet<string>> {
  const loaded = await loadFavoritesArray(sessionsDirectory);
  return new Set(loaded.ok ? loaded.ids : []);
}

export async function writeFavorite(
  sessionsDirectory: string,
  sessionId: string,
  favorite: boolean,
): Promise<boolean> {
  if (sessionId.length === 0) {
    return false;
  }
  const loaded = await loadFavoritesArray(sessionsDirectory);
  if (!loaded.ok) {
    return false;
  }
  const has = loaded.ids.includes(sessionId);
  if (favorite === has) {
    return true;
  }
  const next = favorite
    ? [...loaded.ids, sessionId]
    : loaded.ids.filter((id) => id !== sessionId);

  const file = path.join(sessionsDirectory, FAVORITES_FILE_NAME);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(next), 'utf8');
    await fs.rename(temporary, file);
    return true;
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    return false;
  }
}

type LoadedFavorites =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false };

async function loadFavoritesArray(sessionsDirectory: string): Promise<LoadedFavorites> {
  const file = path.join(sessionsDirectory, FAVORITES_FILE_NAME);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    // A missing file is the documented empty state; anything else
    // (permissions, IO) must not lead to clobbering the CLI's file.
    return isFileMissingError(error) ? { ok: true, ids: [] } : { ok: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((entry): entry is string => typeof entry === 'string')
    ) {
      return { ok: false };
    }
    return { ok: true, ids: parsed };
  } catch {
    return { ok: false };
  }
}

function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
