import {
  ProcessTransport,
  createSession,
  resumeSession,
  type DroidObservability,
  type StringFramedDroidClientTransport,
} from '@factory/droid-sdk/node';
import { createCapturedSessionView } from '../session/capturedSessionView';
import { type RuntimeSessionTarget } from '../DroidRuntime';
import { createModelCatalogCaptureTransport } from './modelCatalogCaptureTransport';
import {
  createProvisionalProcessTransport,
  type ProcessSessionTransport,
} from './processSessionTransport';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from '../events/runtimeInteractions';
import type { FactoryDroidSession } from '../session/sessionTypes';

export interface LocalSessionDependencies {
  createTransport(options: {
    cwd: string;
    observability?: DroidObservability;
  }): ProcessSessionTransport;
  createSession(options: {
    cwd: string;
    transport: StringFramedDroidClientTransport;
    observability?: DroidObservability;
    permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
    askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
  }): Promise<FactoryDroidSession>;
  resumeSession(
    sessionId: string,
    options: {
      transport: StringFramedDroidClientTransport;
      observability?: DroidObservability;
      permissionHandler: RuntimeInteractionCallbacks['permissionHandler'];
      askUserHandler: RuntimeInteractionCallbacks['askUserHandler'];
    },
  ): Promise<FactoryDroidSession>;
}

export const localSessionDependencies: LocalSessionDependencies = {
  createTransport: (options) => new ProcessTransport(options),
  createSession,
  resumeSession,
};

export async function createLocalDroidSession(
  {
    target,
    interactionHandler,
    observability,
  }: {
    target: RuntimeSessionTarget;
    interactionHandler: RuntimeInteractionHandler;
    observability?: DroidObservability;
  },
  dependencies: LocalSessionDependencies = localSessionDependencies,
): Promise<FactoryDroidSession> {
  if (target.kind === 'new' && target.worktree === true) {
    // Only the daemon has the native create-worktree-and-run channel;
    // reaching this factory with a worktree target is a wiring bug and
    // must not silently produce a plain session in the workspace.
    throw new Error('Worktree sessions require the daemon runtime mode.');
  }
  const observabilityOptions = observability === undefined ? {} : { observability };
  const transport = createProvisionalProcessTransport(
    dependencies.createTransport({
      cwd: target.cwd,
      ...observabilityOptions,
    }),
  );

  try {
    await transport.connect();

    const interactionCallbacks = createRuntimeInteractionCallbacks(interactionHandler);
    const catalogCapture = createModelCatalogCaptureTransport(transport);
    const session =
      target.kind === 'resume'
        ? await dependencies.resumeSession(target.sessionId, {
            transport: catalogCapture.transport,
            ...observabilityOptions,
            ...interactionCallbacks,
          })
        : await dependencies.createSession({
            cwd: target.cwd,
            transport: catalogCapture.transport,
            ...observabilityOptions,
            ...interactionCallbacks,
          });

    const availableModels = catalogCapture.readAvailableModels();
    return createCapturedSessionView(session, availableModels);
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // Preserve the connection or session-establishment failure.
    }
    throw error;
  }
}
