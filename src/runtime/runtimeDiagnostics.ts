export type RuntimeDiagnosticAttribute = string | number | boolean | null;

export interface RuntimeDiagnosticEvent {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly name: string;
  readonly attributes?: Readonly<
    Record<string, RuntimeDiagnosticAttribute>
  >;
  /**
   * Free text payload (prompt text, tool detail, raw error, stack).
   * The sink applies credential scrubbing and a length bound; no other
   * filtering (full-fidelity local logging by user decision).
   */
  readonly detail?: string;
}

export interface RuntimeDiagnosticSink {
  record(event: RuntimeDiagnosticEvent): void;
  /**
   * Optional turn correlation scope: while a scope is open the sink
   * stamps every record (host, sdk, and webview beacons) with the
   * Bridge turnId so one interaction reads as a single timeline.
   */
  beginTurnScope?(turnId: string): void;
  endTurnScope?(): void;
}
