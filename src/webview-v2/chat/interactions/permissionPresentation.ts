import type { PermissionInteractionRequest } from '../../../shared/protocol/interactions';

export function isNegativePermissionOption(option: PermissionInteractionRequest['options'][number]): boolean {
  return /cancel|deny|reject/i.test(`${option.value} ${option.label}`);
}

export function getPermissionPresentation(request: PermissionInteractionRequest): {
  readonly kind: 'permission' | 'plan' | 'mission';
  readonly eyebrow: string;
  readonly title: string;
  readonly planPreview?: string;
} {
  const kinds = new Set(request.tools.map((tool) => tool.confirmationKind));
  if (kinds.has('exit_spec_mode')) return {
    kind: 'plan', eyebrow: 'Implementation plan · ExitSpecMode',
    title: 'Droid has completed planning and is ready to implement',
    ...(request.editableSpecContent === undefined ? {} : { planPreview: request.editableSpecContent }),
  };
  if (kinds.has('propose_mission') || kinds.has('start_mission_run')) return {
    kind: 'mission', eyebrow: `Mission · ${(request.tools[0]?.confirmationKind ?? 'confirmation').replaceAll('_', ' ')}`,
    title: request.tools[0]?.title ?? 'Mission confirmation',
  };
  return { kind: 'permission', eyebrow: 'Permission request', title: `Review ${request.tools.length} ${request.tools.length === 1 ? 'action' : 'actions'}` };
}
