import type { ChatPort } from './chatIntent';

/** Record stalls without message text, DOM content or a continuous polling timer. */
export function observeChatLongTasks(port: ChatPort): () => void {
  if (typeof PerformanceObserver === 'undefined' ||
      !PerformanceObserver.supportedEntryTypes.includes('longtask')) return () => {};
  const observer = new PerformanceObserver((list) => {
    const tasks = list.getEntries().filter(entry => entry.duration >= 200);
    if (tasks.length === 0) return;
    port.postMessage({ type: 'webview.diagnostic', kind: 'perf-longtask', detail: JSON.stringify({
      source: 'chat.longtask', count: tasks.length,
      totalMs: Math.round(tasks.reduce((sum, entry) => sum + entry.duration, 0)),
      maxMs: Math.round(Math.max(...tasks.map(entry => entry.duration))),
      startMs: Math.round(tasks[0]!.startTime),
    }) });
  });
  observer.observe({ type: 'longtask' });
  return () => observer.disconnect();
}
