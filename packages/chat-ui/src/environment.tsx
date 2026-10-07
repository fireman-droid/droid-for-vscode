import { createContext, useContext, type ReactNode } from 'react';
import type { SyntaxWorkerFactory } from './syntax/syntaxProtocol';

export interface UiEnvironment {
  readonly assistantName: string;
  readonly copyText: (text: string) => Promise<void>;
  readonly createSyntaxWorker?: SyntaxWorkerFactory;
}

const Environment = createContext<UiEnvironment>({
  assistantName: 'Assistant',
  copyText: (text) => navigator.clipboard.writeText(text),
});

/** Host services stay outside the rendering package, including clipboard IPC. */
export function UiEnvironmentProvider({ value, children }: {
  readonly value: UiEnvironment;
  readonly children: ReactNode;
}) {
  return <Environment.Provider value={value}>{children}</Environment.Provider>;
}

export function useUiEnvironment(): UiEnvironment {
  return useContext(Environment);
}
