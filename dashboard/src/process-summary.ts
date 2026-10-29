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
  const quota = timing.quota;
  const quotaParts: string[] = [];
  if (quota?.fiveHourRemaining !== undefined) quotaParts.push(uiText(`5h 剩余 ${quota.fiveHourRemaining}%`, `5h left ${quota.fiveHourRemaining}%`));
  if (quota?.weeklyRemaining !== undefined) quotaParts.push(uiText(`周剩余 ${quota.weeklyRemaining}%`, `Weekly left ${quota.weeklyRemaining}%`));
  const quotaText = quota
    ? quotaParts.length ? `${quota.label} ${quotaParts.join(' · ')}` : uiText('额度 —', 'Allowance —')
    : timing.weeklyRemainingPercent === undefined ? null : uiText(`周剩余 ${timing.weeklyRemainingPercent}%`, `Weekly left ${timing.weeklyRemainingPercent}%`);
  const quotaTitle = quota
    ? uiText(`回答完成时的 ${quota.label} 订阅额度剩余比例`, `${quota.label} subscription allowance remaining when this response completed`)
    : uiText('回答完成时的 Codex 订阅周额度剩余比例', 'Codex weekly allowance remaining when this response completed');
  return h('span', { className: 'codex-process-summary' },
    h('span', { 'data-testid': 'codex-tool-duration' }, duration === undefined ? uiText('耗时未知', 'Unknown duration') : uiText(`耗时 ${formatProcessedDuration(duration)}`, `Duration ${formatProcessedDuration(duration)}`)),
    completed ? h('time', { dateTime: completed.toISOString(), className: 'codex-response-time', title: uiText('回答完成时间', 'Response completed at') }, completed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })) : null,
    completed && quotaText ? h('span', { className: 'codex-weekly-quota', title: quotaTitle }, quotaText) : null);
}
