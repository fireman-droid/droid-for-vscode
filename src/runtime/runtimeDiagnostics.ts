export type RuntimeDiagnosticAttribute = string | number | boolean | null;

export interface RuntimeDiagnosticEvent {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly name: string;
  readonly attributes?: Readonly<
    Record<string, RuntimeDiagnosticAttribute>
  >;
}

export interface RuntimeDiagnosticSink {
  record(event: RuntimeDiagnosticEvent): void;
}
