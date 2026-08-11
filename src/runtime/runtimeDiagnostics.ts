export type RuntimeDiagnosticAttribute = string | number | boolean | null;

export interface RuntimeDiagnosticEvent {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly name: string;
  readonly attributes?: Readonly<
    Record<string, RuntimeDiagnosticAttribute>
  >;
  /**
   * Bounded free text for failure reports (webview boot errors and
   * similar) where redacting the message would make the record useless.
   * Only explicit failure paths may set it; regular events keep using
   * the redaction-safe attributes.
   */
  readonly detail?: string;
}

export interface RuntimeDiagnosticSink {
  record(event: RuntimeDiagnosticEvent): void;
}
