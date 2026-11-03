import { describe, expect, it } from 'vitest';

import type {
  PermissionInteractionRequest,
  PermissionToolSummary,
} from '../../../shared/protocol/interactions';
import { getPermissionPresentation } from './permissionPresentation';

function request(tools: PermissionToolSummary[]): PermissionInteractionRequest {
  return {
    requestId: 'request-1',
    kind: 'permission',
    tools,
    options: [{ label: 'Cancel', value: 'cancel', requiresEditedSpec: false }],
  };
}

describe('permission presentation', () => {
  it('groups RecommendMission with the existing mission presentations', () => {
    const presentation = getPermissionPresentation(
      request([
        {
          toolUseId: 'tool-1',
          toolName: 'RecommendMission',
          confirmationKind: 'recommend_mission',
          title: 'Recommend mission',
          detail: 'This work should run as a mission.',
        },
      ]),
    );

    expect(presentation).toMatchObject({
      kind: 'mission',
      eyebrow: 'Mission · recommend mission',
      title: 'Recommend mission',
    });
  });

  it('keeps a Script batch in the generic permission presentation', () => {
    const presentation = getPermissionPresentation(
      request([
        {
          toolUseId: 'tool-1',
          toolName: 'Script',
          confirmationKind: 'script',
          title: 'Run script · 2 operations',
        },
      ]),
    );

    expect(presentation.kind).toBe('permission');
    expect(presentation.title).toBe('Review 1 action');
  });
});
