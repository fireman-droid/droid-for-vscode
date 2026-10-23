import { useCallback, useEffect, useRef, useState } from 'react';
import { MANAGEMENT_VERSION, parseManagementHostMessage, type ManagementAction, type ManagementPage,
  type ManagementRequest, type ManagementResult, type ManagementSettings } from '../../shared/protocol/managementPageProtocol';
import type { FactoryAccountState } from '../../shared/protocol/factoryAccountProtocol';
import type { ModelsTransport } from '../models/useModels';

export interface ManagementTransport extends ModelsTransport { postManagement(message: ManagementRequest): void }
export function useManagement(transport: ManagementTransport) {
  const [page, setPage] = useState<ManagementPage>('general');
  const [settings, setSettings] = useState<ManagementSettings | null>(null);
  const [account, setAccount] = useState<FactoryAccountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const pending = useRef<{ id: string; action: ManagementAction['kind']; resolve: (result: ManagementResult) => void } | null>(null);
  const accountRequestId = useRef<string | null>(null);
  const next = useRef(0);
  const send = useCallback((action: ManagementAction): Promise<ManagementResult> => {
    const requestId = `management-${Date.now()}-${++next.current}`;
    if (action.kind === 'account.read') {
      accountRequestId.current = requestId;
      transport.postManagement({ type: 'management.request', version: MANAGEMENT_VERSION, requestId, action });
      return Promise.resolve({ type: 'management.result', version: MANAGEMENT_VERSION, requestId, ok: true });
    }
    if (pending.current) return Promise.resolve({ type: 'management.result', version: MANAGEMENT_VERSION, requestId, ok: false, message: '请等待当前操作完成。' });
    return new Promise(resolve => {
      pending.current = { id: requestId, action: action.kind, resolve };
      transport.postManagement({ type: 'management.request', version: MANAGEMENT_VERSION, requestId, action });
    });
  }, [transport]);
  const run = useCallback((action: ManagementAction): Promise<ManagementResult> => {
    if (pending.current) return send(action);
    setBusy(true); setNotice(null);
    return send(action);
  }, [send]);
  useEffect(() => {
    const off = transport.subscribe(value => {
      const message = parseManagementHostMessage(value);
      if (!message) return;
      if (message.type === 'management.navigate') { setPage(message.page); setNotice(null); return; }
      if (message.type === 'management.settings') { setSettings(message.settings); return; }
      if (message.requestId === accountRequestId.current) {
        accountRequestId.current = null;
        if (message.account) setAccount(message.account);
        return;
      }
      if (pending.current?.id !== message.requestId) return;
      const operation = pending.current; pending.current = null;
      if (message.settings) setSettings(message.settings);
      if (message.account) setAccount(message.account);
      setBusy(false);
      setNotice(message.message ? { ok: message.ok, message: message.message } : null);
      operation.resolve(message);
    });
    // The account read is quiet: it feeds the sidebar footer and must not
    // lock the page's controls while the network request is in flight.
    void send({ kind: 'ready' });
    void send({ kind: 'account.read', force: false });
    return () => {
      off(); pending.current?.resolve({ type: 'management.result', version: MANAGEMENT_VERSION,
        requestId: pending.current.id, ok: false, message: '管理页已关闭。' });
      pending.current = null;
      accountRequestId.current = null;
    };
  }, [transport, send]);
  return { page, setPage, settings, account, busy, notice, setNotice, run };
}
export type ManagementState = ReturnType<typeof useManagement>;
