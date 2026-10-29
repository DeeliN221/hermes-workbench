import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeSession } from '../dashboard/src/codex-api';
import {
  SESSION_COLORS,
  defaultSessionColor,
  normalizeSessionColor,
  primeSessionColors,
  resetSessionColors,
  saveSessionColor,
  sessionColor,
  subscribeSessionColors,
} from '../dashboard/src/session-colors';

beforeEach(() => resetSessionColors());

describe('Codex session accent colours', () => {
  it('ships exactly the seven rainbow palette entries', () => {
    expect([...SESSION_COLORS]).toEqual([
      '#ef4444', '#f97316', '#eab308', '#22c55e',
      '#06b6d4', '#3b82f6', '#8b5cf6',
    ]);
  });

  it('derives a stable fallback from the profile and session id', () => {
    const first = defaultSessionColor('default', 'session-1');
    expect(defaultSessionColor('default', 'session-1')).toBe(first);
    expect(SESSION_COLORS).toContain(first);
    expect(SESSION_COLORS).toContain(defaultSessionColor('writer', 'session-1'));
    expect(SESSION_COLORS).toContain(defaultSessionColor('default', 'session-2'));
  });

  it('only accepts #RRGGBB or an empty string', () => {
    expect(normalizeSessionColor('#3B82F6')).toBe('#3b82f6');
    expect(normalizeSessionColor('')).toBe('');
    for (const value of ['#fff', 'red', '#12345', '#1234567', '#12345g', null, 42]) {
      expect(normalizeSessionColor(value)).toBe('');
    }
  });

  it('prefers the explicit colour and falls back to the deterministic default', () => {
    primeSessionColors('default', [{ id: 'session-1', color: '#3B82F6' }]);
    expect(sessionColor('default', 'session-1')).toBe('#3b82f6');
    expect(sessionColor('writer', 'session-1')).toBe(defaultSessionColor('writer', 'session-1'));
    primeSessionColors('default', [{ id: 'session-1', color: '' }]);
    expect(sessionColor('default', 'session-1')).toBe(defaultSessionColor('default', 'session-1'));
  });

  it('updates both surfaces synchronously while a save is in flight', async () => {
    primeSessionColors('default', [{ id: 'session-1', color: '#3b82f6' }]);
    let release!: (value: unknown) => void;
    const read = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const listener = vi.fn();
    subscribeSessionColors(listener);

    const saving = saveSessionColor(read as any, 'default', 'session-1', '#f97316');
    expect(sessionColor('default', 'session-1')).toBe('#f97316');
    expect(listener).toHaveBeenCalled();

    release({ session: { id: 'session-1', color: '#f97316' } });
    await saving;
    expect(sessionColor('default', 'session-1')).toBe('#f97316');
  });

  it('rolls back to the previous colour when the patch fails', async () => {
    primeSessionColors('default', [{ id: 'session-1', color: '#3b82f6' }]);
    const read = vi.fn(async () => { throw new Error('offline'); });
    await expect(saveSessionColor(read as any, 'default', 'session-1', '#f43f5e'))
      .rejects.toThrow('offline');
    expect(sessionColor('default', 'session-1')).toBe('#3b82f6');
  });

  it('does not let a stale list poll overwrite a pending local write', async () => {
    let release!: (value: unknown) => void;
    const read = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const saving = saveSessionColor(read as any, 'default', 'session-1', '#22c55e');
    primeSessionColors('default', [{ id: 'session-1', color: '#3b82f6' }]);
    expect(sessionColor('default', 'session-1')).toBe('#22c55e');
    release({ session: { id: 'session-1', color: '#22c55e' } });
    await saving;
    expect(sessionColor('default', 'session-1')).toBe('#22c55e');
  });

  it('reads the persisted colour through the session normalizer', () => {
    expect(normalizeSession({ id: 'session-1', color: '#F59E0B' })?.color).toBe('#f59e0b');
    expect(normalizeSession({ id: 'session-1', color: 'orange' })?.color).toBe('');
    expect(normalizeSession({ id: 'session-1' })?.color).toBe('');
  });
});
