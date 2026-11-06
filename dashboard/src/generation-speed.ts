import { uiText } from './ui-locale';
import { useChatDisplayPreferences } from './chat-display-preferences';
import './generation-speed.css';

export interface GenerationMetrics {
  outputTokens: number; reasoningOutputTokens?: number; activeSeconds: number;
  samples: number; timingBasis?: string; tokensPerSecond?: number;
}
export function normalizeGenerationMetrics(value: unknown): GenerationMetrics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!finite(row.outputTokens) || !finite(row.activeSeconds) || !finite(row.samples)) return undefined;
  const estimated = row.timingBasis === 'observed-response-time';
  const valid = (estimated || row.timingBasis === 'model-generation' && row.samples >= 2) && row.activeSeconds >= .25 && row.outputTokens >= 2;
  const rate = valid ? row.outputTokens / row.activeSeconds : undefined;
  return { timingBasis: typeof row.timingBasis === 'string' ? row.timingBasis : undefined, outputTokens: row.outputTokens, activeSeconds: row.activeSeconds, samples: row.samples,
    reasoningOutputTokens: finite(row.reasoningOutputTokens) ? row.reasoningOutputTokens : undefined,
    tokensPerSecond: finite(rate) ? rate : undefined };
}
export function generationSpeedLabel(metrics?: GenerationMetrics): string {
  return metrics?.tokensPerSecond === undefined ? '—' : `${metrics.timingBasis === 'observed-response-time' ? '≈' : ''}${metrics.tokensPerSecond.toFixed(1)} tok/s`;
}
export function generationSpeedDetails(metrics?: GenerationMetrics): string {
  const definition = metrics?.timingBasis === 'model-generation'
    ? uiText('模型输出 token / 模型生成时间，不含工具返回、排队和等待。', 'Model output tokens / model generation time, excluding tool output, queueing and waits.')
    : metrics?.timingBasis === 'observed-response-time'
    ? uiText('估算速度：上游输出 token / 请求处理时间，扣除工具执行和审批等待，包含推理、网络和排队耗时。工具返回不计入输出。', 'Estimated speed: provider output tokens / observed response time, excluding tool execution and approval waits. Includes reasoning, network and queueing time. Tool output is excluded.')
    : uiText('仅有上游模型输出 token 计数；事件间隔无法准确区分生成、排队和等待，暂不显示 TPS。工具返回不计入输出。', 'Only provider model output token counts are available. Event gaps cannot reliably separate generation, queueing and waits; TPS is unavailable. Tool output is excluded.');
  if (!metrics) return definition + ' ' + uiText('样本不足。', 'Insufficient samples.');
  const reasoning = metrics.reasoningOutputTokens === undefined
    ? uiText('reasoning 明细未提供（沿用上游输出口径）', 'Reasoning breakdown unavailable (provider output counter)')
    : uiText(`其中 reasoning ${metrics.reasoningOutputTokens} token（已包含）`, `Includes ${metrics.reasoningOutputTokens} reasoning tokens`);
  const counts = metrics.timingBasis === 'model-generation' || metrics.timingBasis === 'observed-response-time'
    ? `${metrics.outputTokens} output tokens / ${metrics.activeSeconds.toFixed(2)} s.`
    : `${metrics.outputTokens} output tokens.`;
  return `${definition} ${counts} ${reasoning}.`;
}
/** Keep TPS as a hidden measurement source; the optional mobile rail renders it. */
export function GenerationSpeed({ React, metrics, sdk, profile }: { React: any; metrics?: GenerationMetrics; sdk: { hooks: any; fetchJSON: any }; profile: string }) {
  const preferences = useChatDisplayPreferences(sdk, profile);
  const h = React.createElement, details = generationSpeedDetails(metrics);
  if (!preferences.generationSpeedEnabled) return null;
  return h('details', { className: 'codex-generation-speed', 'data-testid': 'codex-generation-speed' },
    h('summary', { title: details, 'aria-label': `${generationSpeedLabel(metrics)}. ${details}` }, generationSpeedLabel(metrics)),
    h('span', { className: 'codex-generation-tooltip', role: 'tooltip' }, details));
}

/** Latest turn only, shared by live updates and restored transcripts. */
export function latestGenerationMetrics(messages: Array<{ turnId?: string; generationMetrics?: GenerationMetrics }>): GenerationMetrics | undefined {
  const latest = [...messages].reverse();
  const latestTurn = latest.find(message => message.turnId)?.turnId;
  return latest.find(message => message.turnId === latestTurn && message.generationMetrics)?.generationMetrics;
}
