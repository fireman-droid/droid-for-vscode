/** Native rewind succeeded; only attaching its replacement session failed. */
export class RewindAttachmentError extends Error {
  constructor(
    readonly newSessionId: string,
    readonly messageId: string,
    cause: unknown,
  ) {
    super('The rewind completed, but its replacement session could not be attached.', { cause });
    this.name = 'RewindAttachmentError';
  }
}

/** A completed rewind must be connected before another anchor can be used. */
export class RewindAnchorConflictError extends Error {
  constructor(readonly messageId: string) {
    super('Reconnect the completed rewind from its original message before editing another message.');
    this.name = 'RewindAnchorConflictError';
  }
}

/** The host stopped before it could durably record the native result. */
export class RewindOutcomeUnknownError extends Error {
  constructor(readonly messageId: string, cause?: unknown) {
    super('The previous rewind outcome is unknown. Do not repeat it; inspect the workspace and Droid session history.', { cause });
    this.name = 'RewindOutcomeUnknownError';
  }
}
