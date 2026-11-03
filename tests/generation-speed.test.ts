import { describe, expect, it } from 'vitest';
import { applyChatEvent, messagesFromTurns } from '../dashboard/src/codex-messages';
import { generationSpeedLabel, generationSpeedDetails, normalizeGenerationMetrics, generationSpeedPlacements } from '../dashboard/src/generation-speed';
const metrics = { outputTokens: 100, reasoningOutputTokens: 40, activeSeconds: 2, samples: 3 };
describe('generation speed', () => {
  it('uses output including reasoning once and guards invalid samples', () => {
    const value = normalizeGenerationMetrics(metrics)!;
    expect(generationSpeedLabel(value)).toBe('50.0 tok/s');
    expect(generationSpeedDetails(value)).toContain('40 reasoning');
    for (const activeSeconds of [0, .1, Infinity, NaN]) {
      expect(generationSpeedLabel(normalizeGenerationMetrics({ ...metrics, activeSeconds }))).toBe('—');
    }
    expect(generationSpeedLabel(normalizeGenerationMetrics({ ...metrics, samples: 1 }))).toBe('—');
  });
  it('retains live metrics through final items, completion, quota updates and snapshots', () => {
    let messages = messagesFromTurns([{ id: 't', items: [{ id: 'a', type: 'agentMessage', text: 'Hello' }], generationMetrics: metrics }], 'session');
    expect(messages[0].generationMetrics?.tokensPerSecond).toBe(50);
    messages = applyChatEvent(messages, { method: 'token_usage_record', params: { generationMetrics: { ...metrics, outputTokens: 200, turnId: 't' } } });
    messages = applyChatEvent(messages, { method: 'item/completed', params: { turnId: 't', item: { id: 'a', type: 'agentMessage', text: 'Hello again' } } });
    messages = applyChatEvent(messages, { method: 'turn/completed', params: { turn: { id: 't', status: 'completed' } } });
    messages = applyChatEvent(messages, { method: 'workbench/turnMetrics', params: { turnId: 't', completedAt: Date.now() } });
    expect(messages[0].generationMetrics?.tokensPerSecond).toBe(100);
  });
});

it('places one chip per measured turn, without touching unmeasured Hermes messages', () => {
  const value = normalizeGenerationMetrics(metrics)!;
  const placements = generationSpeedPlacements([
    { kind: 'message', message: { turnId: 'first', generationMetrics: value } },
    { kind: 'process', messages: [{ turnId: 'first', generationMetrics: value }] },
    { kind: 'message', message: { turnId: 'first' } },
    { kind: 'message', message: {} },
    { kind: 'process', messages: [{ turnId: 'second', generationMetrics: value }] },
  ]);
  expect([...placements.keys()]).toEqual([2, 4]);
});
