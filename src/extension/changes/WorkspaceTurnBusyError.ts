/** Identifies the durable owner without extracting a session ID from display text. */
export class WorkspaceTurnBusyError extends Error {
  constructor(readonly sessionId: string) {
    super(`This workspace has an unfinished captured turn. Reopen session ${sessionId} to finish recording it before sending another turn.`);
  }
}
