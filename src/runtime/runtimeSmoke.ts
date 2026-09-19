import { FactoryDroidRuntime } from './FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from './events/runtimeInteractions';

if (process.env.DROIDVISX_RUN_SMOKE !== '1') {
  console.error('Runtime smoke is opt-in. Set DROIDVISX_RUN_SMOKE=1 to run it locally.');
  process.exitCode = 2;
} else {
  await runSmoke();
}

async function runSmoke(): Promise<void> {
  const runtime = new FactoryDroidRuntime({
    interactionHandler: cancellingRuntimeInteractionHandler,
  });
  const eventTypes = new Set<string>();
  let outcome: string | undefined;
  let interruptionRequested = false;
  let stage = 'initialize';
  let cleanup = 'unknown';
  let failure:
    | {
        stage: string;
        reason: string;
      }
    | undefined;

  try {
    const availability = await runtime.initialize(process.cwd());
    if (availability.status !== 'available') {
      failure = {
        stage,
        reason: availability.reason,
      };
    } else {
      stage = 'turn';
      for await (const event of runtime.sendTurn(
        'Write the integers from 1 through 1000, one per line.',
      )) {
        eventTypes.add(event.type);

        if (!interruptionRequested && event.type !== 'turn-complete') {
          interruptionRequested = true;
          await runtime.interrupt();
        }

        if (event.type === 'turn-complete') {
          outcome = event.outcome;
        }
      }

      stage = 'validation';
      if (!interruptionRequested || outcome !== 'interrupted') {
        failure = {
          stage,
          reason: 'interrupt-not-confirmed',
        };
      }
    }
  } catch (error) {
    failure = {
      stage,
      reason: error instanceof Error ? error.name : 'UnknownError',
    };
  } finally {
    try {
      stage = 'cleanup';
      await runtime.dispose();
      cleanup = 'disposed';
    } catch (error) {
      cleanup = 'failed';
      failure = {
        stage,
        reason: error instanceof Error ? error.name : 'UnknownError',
      };
    }
  }

  const result = {
    eventTypes: [...eventTypes].sort(),
    outcome,
    cleanup,
  };

  if (failure) {
    console.error(
      JSON.stringify({
        status: 'failed',
        ...failure,
        ...result,
      }),
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({
        status: 'passed',
        ...result,
      }),
    );
  }
}
