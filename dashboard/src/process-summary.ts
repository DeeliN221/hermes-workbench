import { uiText } from './ui-locale';
import { formatProcessedDuration } from './chat-display/duration';
import type { ProcessTiming } from './chat-process-messages';

type ReactHost = {
  createElement: (...args: any[]) => any;
  useState<T>(value: T): [T, (update: (value: T) => T) => void];
  useEffect(effect: () => void | (() => void), dependencies: unknown[]): void;
};
export function ProcessSummary({ React, timing }: { React: ReactHost; timing: ProcessTiming }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (!timing.running || timing.startedAt === undefined) return;
    const timer = setInterval(() => tick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [timing.running, timing.startedAt]);
  const duration = timing.running && timing.startedAt !== undefined ? Math.max(0, Date.now() - timing.startedAt) : timing.duration;
  const h = React.createElement;
  const completed = timing.completedAt === undefined ? null : new Date(timing.completedAt);
  return h('span', { className: 'codex-process-summary' },
    h('span', { 'data-testid': 'codex-tool-duration' }, duration === undefined ? uiText('耗时未知', 'Unknown duration') : uiText(`耗时 ${formatProcessedDuration(duration)}`, `Duration ${formatProcessedDuration(duration)}`)),
    completed ? h('time', { dateTime: completed.toISOString(), className: 'codex-response-time', title: uiText('回答完成时间', 'Response completed at') }, completed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })) : null,
    completed ? h('span', { className: 'codex-weekly-quota', title: uiText('回答完成时的 Codex 订阅周额度剩余比例', 'Codex weekly allowance remaining when this response completed') }, timing.weeklyRemainingPercent === undefined ? uiText('周额度 —', 'Weekly —') : uiText(`周剩余 ${timing.weeklyRemainingPercent}%`, `Weekly left ${timing.weeklyRemainingPercent}%`)) : null);
}
