import { useCallback, useEffect, useRef, useState } from 'react';
import { MANAGEMENT_VERSION, parseManagementHostMessage, type ManagementAction, type ManagementPage,
  type ManagementRequest, type ManagementResult, type ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import type { ModelsTransport } from '../models/useModels';

export interface ManagementTransport extends ModelsTransport { postManagement(message: ManagementRequest): void }
export function useManagement(transport: ManagementTransport) {
  const [page, setPage] = useState<ManagementPage>('general');
  const [settings, setSettings] = useState<ManagementSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const pending = useRef<{ id: string; resolve: (result: ManagementResult) => void } | null>(null);
  const next = useRef(0);
  const run = useCallback((action: ManagementAction): Promise<ManagementResult> => {
    const requestId = `management-${Date.now()}-${++next.current}`;
    if (pending.current) return Promise.resolve({ type: 'management.result', version: MANAGEMENT_VERSION, requestId, ok: false, message: '请等待当前操作完成。' });
    setBusy(true); setNotice(null);
    return new Promise(resolve => {
      pending.current = { id: requestId, resolve };
      transport.postManagement({ type: 'management.request', version: MANAGEMENT_VERSION, requestId, action });
    });
  }, [transport]);
  useEffect(() => {
    const off = transport.subscribe(value => {
      const message = parseManagementHostMessage(value);
      if (!message) return;
      if (message.type === 'management.navigate') { setPage(message.page); setNotice(null); return; }
      if (message.type === 'management.settings') { setSettings(message.settings); return; }
      if (pending.current?.id !== message.requestId) return;
      const operation = pending.current; pending.current = null;
      if (message.settings) setSettings(message.settings);
      setBusy(false);
      setNotice(message.message ? { ok: message.ok, message: message.message } : null);
      operation.resolve(message);
    });
    void run({ kind: 'ready' });
    return () => {
      off(); pending.current?.resolve({ type: 'management.result', version: MANAGEMENT_VERSION,
        requestId: pending.current.id, ok: false, message: '管理页已关闭。' });
      pending.current = null;
    };
  }, [transport, run]);
  return { page, setPage, settings, busy, notice, setNotice, run };
}
export type ManagementState = ReturnType<typeof useManagement>;
