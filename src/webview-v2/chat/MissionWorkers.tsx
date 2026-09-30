import { useEffect, useState } from 'react';
import { ChevronRight, LoaderCircle } from 'lucide-react';
import type { MissionControlResultMessage, MissionSnapshotMessage } from '../../shared/protocol/missionProtocol';
import type { ChatPort } from '../host/chatIntent';
import { Tool, ToolContent, ToolHeader } from '../ai-elements/tool';
import { Button } from '../ui/button';
import { useMissionControl } from '../mission/useMissionControl';
import { createMissionRequestId, formatPhase } from '../mission/workspacePresentation';

const requestId = () => createMissionRequestId('chat-mission-worker');
const statusLabels = { running: 'Running', paused: 'Paused', finished: 'Finished', failed: 'Failed', unknown: 'Status unavailable' };

/** Mission workers have real sessions but are not Task tool transcript rows. */
export function MissionWorkers({ mission, result, port, disabled }: {
  readonly mission: MissionSnapshotMessage | null;
  readonly result: MissionControlResultMessage | null;
  readonly port: ChatPort;
  readonly disabled: boolean;
}) {
  const command = useMissionControl(port, requestId);
  const [request, setRequest] = useState<{
    id: string; featureId?: string; status: 'pending' | 'accepted' | 'rejected' | 'unconfirmed';
  } | null>(null);
  useEffect(() => {
    if (result) setRequest(current => current?.id === result.requestId
      ? { ...current, status: result.status } : current);
  }, [result]);
  useEffect(() => {
    if (request?.status !== 'pending') return;
    const id = request.id;
    const unconfirm = () => setRequest(current => current?.id === id && current.status === 'pending'
      ? { ...current, status: 'unconfirmed' } : current);
    if (disabled) { unconfirm(); return; }
    const timer = setTimeout(unconfirm, 10_000);
    return () => clearTimeout(timer);
  }, [disabled, request?.id, request?.status]);
  const workers = mission?.features.filter(feature => feature.workerViewAvailable === true) ?? [];
  const failed = request?.status === 'rejected' || request?.status === 'unconfirmed';
  return <Tool defaultOpen className="my-3 rounded-lg border border-[var(--panel-edge)] px-2 py-1">
    <ToolHeader title="Mission · 子代理" status={mission ? `${mission.completedFeatureCount} / ${mission.features.length} features completed` : 'Loading…'} />
    <ToolContent className="space-y-2 pl-0 pb-1">
      {mission ? <p className="px-2 text-[11px] text-muted-foreground">{formatPhase(mission)}</p> : null}
      {workers.map(feature => {
        const status = mission?.availability === 'attached' ? feature.workerStatus ?? 'unknown' : 'unknown';
        const opening = request?.featureId === feature.id && request.status === 'pending';
        return <div key={feature.id} className="space-y-2 rounded-md bg-muted/30 p-2.5">
          <p className="text-xs font-medium text-foreground [overflow-wrap:anywhere]">{feature.title}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 text-[11px] ${status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {status === 'running' ? <LoaderCircle aria-hidden="true" className="size-3 motion-safe:animate-spin" /> : null}
              Mission worker · {statusLabels[status]}
            </span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={disabled || opening}
              aria-label={`查看子代理：${feature.title}`} onClick={() => setRequest({ status: 'pending', featureId: feature.id, id: command({
                type: 'mission.viewer.open', revision: mission!.revision, featureId: feature.id,
              }) })}>{opening ? '正在打开…' : '查看子代理'}<ChevronRight aria-hidden="true" className="size-3" /></Button>
          </div>
        </div>;
      })}
      {workers.length === 0 ? <p role="status" className="px-2 text-xs text-muted-foreground">等待 Droid 提供 Worker 会话，分配后可在这里查看子代理活动。</p> : null}
      {failed ? <div role="status" className="flex flex-wrap items-center gap-2 px-2 text-xs text-muted-foreground">
        <span>{request?.status === 'unconfirmed' ? '未收到操作结果，可以重新点击查看子代理。' : 'Worker 状态已变化或会话暂不可用，请刷新后重试。'}</span>
        <Button variant="ghost" size="sm" disabled={disabled || mission === null} onClick={() => {
          if (mission) setRequest({ status: 'pending', id: command({ type: 'mission.refresh', revision: mission.revision }) });
        }}>刷新状态</Button>
      </div> : null}
    </ToolContent>
  </Tool>;
}
