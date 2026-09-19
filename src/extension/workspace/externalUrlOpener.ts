/**
 * Opens an http(s) URL in the user's default browser. Implementations
 * own scheme validation before handing the URL to the OS.
 */
export interface ExternalUrlOpener {
  openExternal(url: string): Promise<boolean>;
}

export function createUnavailableExternalUrlOpener(): ExternalUrlOpener {
  return {
    openExternal: () => Promise.resolve(false),
  };
}
