import { useEffect, useRef, useState } from 'react';

import type {
  SessionInteractionMode,
  SessionSettingsState,
  SessionSettingUpdateMessage,
} from '../../shared/bridgeMessages';

/** One picked setting, minus the bridge envelope. */
export type SessionSettingSelection =
  SessionSettingUpdateMessage extends infer Message
    ? Message extends SessionSettingUpdateMessage
      ? Omit<Message, 'type' | 'sessionId'>
      : never
    : never;

/**
 * Safety valve for the optimistic trigger label: if no settled
 * settings frame ever arrives (silently dropped update), the pending
 * pick expires instead of pinning a stale label.
 */
const PENDING_PICK_VALVE_MS = 4_000;

/**
 * Optimistic mode/model trigger labels (user report 2026-08-13: the
 * stale label during the update round-trip read as switching lag).
 *
 * `pickSetting` forwards the update and remembers it; `shownMode` /
 * `shownModelId` prefer the remembered pick until the next settled
 * settings frame (status leaving `updating`) reconciles — snapping
 * back if the update was rejected. The timeout valve covers updates
 * that never produce a settings frame at all.
 */
export function useOptimisticSettingPick(
  settings: SessionSettingsState,
  onSettingUpdate: (update: SessionSettingSelection) => void,
): {
  shownMode: SessionInteractionMode | undefined;
  shownModelId: string | undefined;
  pickSetting: (update: SessionSettingSelection) => void;
} {
  const confirmed = settings.value;
  const [pendingPick, setPendingPick] =
    useState<SessionSettingSelection | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const prevStatusRef = useRef(settings.status);

  useEffect(() => {
    const previous = prevStatusRef.current;
    prevStatusRef.current = settings.status;
    if (previous === 'updating' && settings.status !== 'updating') {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      setPendingPick(null);
    }
  }, [settings.status]);
  useEffect(
    () => () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
    },
    [],
  );

  const pickSetting = (update: SessionSettingSelection): void => {
    setPendingPick(update);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      setPendingPick(null);
    }, PENDING_PICK_VALVE_MS);
    onSettingUpdate(update);
  };

  return {
    shownMode:
      pendingPick?.field === 'interactionMode'
        ? pendingPick.value
        : confirmed?.interactionMode,
    shownModelId:
      pendingPick?.field === 'modelId'
        ? pendingPick.value
        : confirmed?.modelId,
    pickSetting,
  };
}
