import { useCallback } from 'react';
import { post, type ChatPort } from '../../host/chatIntent';
import type { McpServerAddParams } from './shared';
import type { SessionSettingSelection } from './useOptimisticSetting';

export function useCapabilityActions({
  vscode,
  sessionId,
  connectionStatus,
}: {
  vscode: ChatPort;
  sessionId: string | null;
  connectionStatus: string;
}) {
  const handleModelCatalogRefresh = useCallback((): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    post(vscode, { type: 'session.model-catalog.refresh', sessionId });
  }, [connectionStatus, sessionId, vscode]);
  const handleContextRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'session.context.refresh',
      sessionId,
    });
  }, [sessionId, vscode]);
  const handleSkillsRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'skills.refresh', sessionId });
  }, [sessionId, vscode]);
  const handleCommandsRefresh = useCallback((): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    post(vscode, { type: 'commands.refresh', sessionId });
  }, [connectionStatus, sessionId, vscode]);
  const handleSkillToggle = useCallback(
    (name: string, disabled: boolean): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'skill.toggle',
        sessionId,
        name,
        disabled,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'mcp.refresh', sessionId });
  }, [sessionId, vscode]);
  const handlePluginsRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'plugins.refresh', sessionId });
  }, [sessionId, vscode]);
  const handleMcpServerToggle = useCallback(
    (name: string, enabled: boolean): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.toggle',
        sessionId,
        name,
        enabled,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpServerAdd = useCallback(
    (params: McpServerAddParams): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.add',
        sessionId,
        ...params,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpServerRemove = useCallback(
    (name: string): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.remove',
        sessionId,
        name,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpServerAuthenticate = useCallback(
    (name: string): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.authenticate',
        sessionId,
        name,
      });
    },
    [sessionId, vscode],
  );
  const handleSettingUpdate = useCallback(
    (update: SessionSettingSelection): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'session.setting.update',
        sessionId,
        ...update,
      });
    },
    [sessionId, vscode],
  );
  return {
    handleModelCatalogRefresh,
    handleContextRefresh,
    handleSkillsRefresh,
    handleCommandsRefresh,
    handleSkillToggle,
    handleMcpRefresh,
    handlePluginsRefresh,
    handleMcpServerToggle,
    handleMcpServerAdd,
    handleMcpServerRemove,
    handleMcpServerAuthenticate,
    handleSettingUpdate,
  };
}
