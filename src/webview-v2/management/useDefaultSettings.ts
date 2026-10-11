import { useEffect, useRef, useState } from 'react';
import { isDefaultsPatch, type DefaultValues, type DefaultsScope, type ManagementDefaults } from '../../shared/protocol/managementDefaultsProtocol';
import type { ManagementState } from './useManagement';

export function useDefaultSettings(state: ManagementState, scope: DefaultsScope, active: boolean) {
  const [snapshot, setSnapshot] = useState<ManagementDefaults | null>(null);
  const [patch, setPatch] = useState<DefaultValues>({});
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const read = async () => {
    setAttempted(true); setError(null);
    const result = await state.run({ kind: 'defaults.read' });
    if (!alive.current) return;
    if (result.ok && result.defaults) { setSnapshot(result.defaults); setPatch({}); }
    else { setError(result.message || '默认设置读取失败，请重试。'); state.setNotice(null); }
  };
  useEffect(() => {
    if (active && state.settings && !state.busy && !attempted) void read();
  }, [active, state.settings, state.busy, attempted]);
  const update = (changes: DefaultValues) => setPatch(previous => {
    const next = { ...previous, ...changes };
    for (const key of Object.keys(changes) as (keyof DefaultValues)[]) {
      if (JSON.stringify(changes[key]) === JSON.stringify(snapshot?.values[key])) delete next[key];
    }
    return next;
  });
  const save = async () => {
    if (state.busy || !isDefaultsPatch(patch, scope)) return;
    setSaving(true); setError(null);
    const result = await state.run({ kind: 'defaults.save', scope, patch });
    if (!alive.current) return;
    setSaving(false);
    if (result.ok && result.defaults) { setSnapshot(result.defaults); setPatch({}); }
    else { setError(result.message || '默认设置保存失败，请重试。'); state.setNotice(null); }
  };
  return { snapshot, values: { ...snapshot?.values, ...patch }, update, save, read, error, saving,
    dirty: Object.keys(patch).length > 0, valid: isDefaultsPatch(patch, scope), reset: () => setPatch({}) };
}
export type DefaultsForm = ReturnType<typeof useDefaultSettings>;
