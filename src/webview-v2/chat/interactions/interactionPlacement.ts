import type { PendingInteraction } from '../../state/store';

/** AskUser and ExitSpecMode own the Composer-adjacent interaction slot. */
export function isFooterInteraction(
  interaction: PendingInteraction | undefined,
): boolean {
  return (
    interaction !== undefined &&
    (interaction.request.kind === 'ask-user' ||
      interaction.request.tools.some(
        ({ confirmationKind }) => confirmationKind === 'exit_spec_mode',
      ))
  );
}
