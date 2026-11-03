import { uiText } from './ui-locale';
import './generation-speed.css';

export interface GenerationMetrics {
  outputTokens: number; reasoningOutputTokens?: number; activeSeconds: number;
  samples: number; tokensPerSecond?: number;
}
export function normalizeGenerationMetrics(value: unknown): GenerationMetrics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!finite(row.outputTokens) || !finite(row.activeSeconds) || !finite(row.samples)) return undefined;
  const valid = row.samples >= 2 && row.activeSeconds >= .25 && row.outputTokens >= 2;
  const rate = valid ? row.outputTokens / row.activeSeconds : undefined;
  return { outputTokens: row.outputTokens, activeSeconds: row.activeSeconds, samples: row.samples,
    reasoningOutputTokens: finite(row.reasoningOutputTokens) ? row.reasoningOutputTokens : undefined,
    tokensPerSecond: finite(rate) ? rate : undefined };
}
export function generationSpeedLabel(metrics?: GenerationMetrics): string {
  return metrics?.tokensPerSecond === undefined ? '—' : `${metrics.tokensPerSecond.toFixed(1)} tok/s`;
}
export function generationSpeedDetails(metrics?: GenerationMetrics): string {
  const definition = uiText('输出 token / 活跃生成时间，不含工具等待；超过 5 秒空闲会断开窗口。', 'Output tokens / active generation time, excluding tool waits; gaps over 5 seconds split the window.');
  if (!metrics) return definition + ' ' + uiText('样本不足。', 'Insufficient samples.');
  const reasoning = metrics.reasoningOutputTokens === undefined
    ? uiText('reasoning 明细未提供（沿用上游输出口径）', 'Reasoning breakdown unavailable (provider output counter)')
    : uiText(`其中 reasoning ${metrics.reasoningOutputTokens} token（已包含）`, `Includes ${metrics.reasoningOutputTokens} reasoning tokens`);
  return `${definition} ${metrics.outputTokens} output tokens / ${metrics.activeSeconds.toFixed(2)} s. ${reasoning}.`;
}
/** Native details supports hover, keyboard and touch without a global overlay. */
export function GenerationSpeed({ React, metrics }: { React: any; metrics?: GenerationMetrics }) {
  const h = React.createElement, details = generationSpeedDetails(metrics);
  return h('details', { className: 'codex-generation-speed', 'data-testid': 'codex-generation-speed' },
    h('summary', { title: details, 'aria-label': `${generationSpeedLabel(metrics)}. ${details}` }, generationSpeedLabel(metrics)),
    h('span', { className: 'codex-generation-tooltip', role: 'tooltip' }, details));
}

/** Place one chip after the last visible block of each measured Codex turn. */
export function generationSpeedPlacements(blocks: Array<
  { kind: 'message'; message: { turnId?: string; generationMetrics?: GenerationMetrics } }
  | { kind: 'process'; messages: Array<{ turnId?: string; generationMetrics?: GenerationMetrics }> }
>): Map<number, { turnId: string; metrics: GenerationMetrics }> {
  const turns = new Map<string, { index: number; metrics?: GenerationMetrics }>();
  blocks.forEach((block, index) => {
    for (const message of block.kind === 'message' ? [block.message] : block.messages) {
      if (!message.turnId) continue;
      turns.set(message.turnId, { index, metrics: message.generationMetrics ?? turns.get(message.turnId)?.metrics });
    }
  });
  const result = new Map<number, { turnId: string; metrics: GenerationMetrics }>();
  for (const [turnId, value] of turns) if (value.metrics) result.set(value.index, { turnId, metrics: value.metrics });
  return result;
}
