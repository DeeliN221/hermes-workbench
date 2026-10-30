import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeSession } from '../dashboard/src/codex-api';
import type { FetchJSON } from '../dashboard/src/workbench-api';
import {
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitleDraft,
  primeSessionTitles,
  renameSessionTitle,
  sessionTitleDraftError,
  sessionTitleEntry,
  sessionTitleErrorCode,
  sessionTitleErrorMessage,
  rememberDerivedSessionTitle,
  resetSessionTitles,
  subscribeSessionTitles,
} from '../dashboard/src/session-titles';

beforeEach(() => resetSessionTitles());

const record = (value: unknown) => vi.fn(async () => value) as unknown as FetchJSON;

describe('session title drafts', () => {
  it('collapses whitespace the same way the server stores it', () => {
    expect(normalizeSessionTitleDraft('  发布前   检查  ')).toBe('发布前 检查');
    expect(normalizeSessionTitleDraft(null)).toBe('');
    expect(normalizeSessionTitleDraft('First\nline\tsecond')).toBe('First line second');
  });

  it('limits the collapsed title, not the raw draft', () => {
    expect(sessionTitleDraftError('x'.repeat(MAX_SESSION_TITLE_LENGTH))).toBeNull();
    expect(sessionTitleDraftError(`${' '.repeat(400)}x`)).toBeNull();
    expect(sessionTitleDraftError('x'.repeat(MAX_SESSION_TITLE_LENGTH + 1))).toBe('too-long');
  });

  it('reads the stored title and its origin from a session payload', () => {
    const named = normalizeSession({ id: 's1', title: 'Renamed', titleSource: 'user', customTitle: 'Renamed' });
    expect(named).toMatchObject({ title: 'Renamed', customTitle: 'Renamed', titleSource: 'user' });
    const derived = normalizeSession({ id: 's1', title: 'First message text', titleSource: 'auto' });
    expect(derived).toMatchObject({ customTitle: null, titleSource: 'auto' });
    expect(normalizeSession({ id: 's1', title: 's1' })).toMatchObject({ customTitle: null, titleSource: null });
  });
});

describe('session title store', () => {
  it('saves a normalized title and notifies every view', async () => {
    const listener = vi.fn();
    subscribeSessionTitles(listener);
    const read = record({ session: { id: 's1', title: 'Sprint 计划', titleSource: 'user', customTitle: 'Sprint 计划' } });
    const session = await renameSessionTitle(read, 'default', 's1', '  Sprint   计划  ');
    expect(session).toMatchObject({ id: 's1', customTitle: 'Sprint 计划' });
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'Sprint 计划', source: 'user' });
    expect(listener).toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(
      '/api/plugins/workbench/codex/sessions/s1/title?profile=default',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Sprint 计划' }) }),
    );
  });

  it('sends null for a blank draft and keeps the cleared state through list polls', async () => {
    const read = record({ session: { id: 's1', title: 's1', titleSource: null, customTitle: null } });
    await renameSessionTitle(read, 'default', 's1', 'First message title');
    await renameSessionTitle(read, 'default', 's1', '   ');
    expect(read).toHaveBeenLastCalledWith(
      '/api/plugins/workbench/codex/sessions/s1/title?profile=default',
      expect.objectContaining({ body: JSON.stringify({ title: null }) }),
    );
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: '', source: 'cleared' });
    primeSessionTitles('default', [{ id: 's1', title: 's1', titleSource: null, customTitle: null }]);
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: '', source: 'cleared' });
    rememberDerivedSessionTitle('default', 's1', 'First message title');
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'First message title', source: 'derived' });
    primeSessionTitles('default', [{ id: 's1', title: 'Next message title', titleSource: 'auto', customTitle: null }]);
    expect(sessionTitleEntry('default', 's1')).toBeNull();
  });

  it('rolls back to the previous title when the server refuses the change', async () => {
    primeSessionTitles('default', [{ id: 's1', title: 'Keep me', titleSource: 'user', customTitle: 'Keep me' }]);
    const read = vi.fn(async () => { throw new Error('404 Session not found'); }) as unknown as FetchJSON;
    await expect(renameSessionTitle(read, 'default', 's1', 'New name')).rejects.toThrow('404');
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'Keep me', source: 'user' });
  });

  it('rejects an over-long draft before touching the network', async () => {
    const read = record({ session: { id: 's1', title: 's1' } });
    await expect(renameSessionTitle(read, 'default', 's1', 'x'.repeat(MAX_SESSION_TITLE_LENGTH + 1))).rejects.toMatchObject({ code: 'too-long' });
    expect(read).not.toHaveBeenCalled();
    expect(sessionTitleEntry('default', 's1')).toBeNull();
  });

  it('adopts server titles and never resurrects a cleared one', () => {
    primeSessionTitles('default', [
      { id: 's1', title: 'Renamed elsewhere', titleSource: 'user', customTitle: 'Renamed elsewhere' },
      { id: 's2', title: 'First message text', titleSource: 'auto', customTitle: null },
    ]);
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'Renamed elsewhere', source: 'user' });
    expect(sessionTitleEntry('default', 's2')).toBeNull();
    expect(sessionTitleEntry('writer', 's1')).toBeNull();
  });

  it('keeps a transcript default until the server names the session, never over an explicit name', () => {
    rememberDerivedSessionTitle('default', 's1', 'First message title');
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'First message title', source: 'derived' });
    primeSessionTitles('default', [{ id: 's1', title: 's1', titleSource: null, customTitle: null }]);
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'First message title', source: 'derived' });
    primeSessionTitles('default', [{ id: 's1', title: 'Chosen name', titleSource: 'user', customTitle: 'Chosen name' }]);
    rememberDerivedSessionTitle('default', 's1', 'First message title');
    expect(sessionTitleEntry('default', 's1')).toEqual({ title: 'Chosen name', source: 'user' });
  });
});

describe('session title errors', () => {
  it('classifies the responses the rename endpoint can return', () => {
    expect(sessionTitleErrorCode(Object.assign(new Error('x'), { status: 404 }))).toBe('not-found');
    expect(sessionTitleErrorCode(Object.assign(new Error('x'), { status: 400 }))).toBe('too-long');
    expect(sessionTitleErrorCode(Object.assign(new Error('x'), { status: 422 }))).toBe('invalid');
    expect(sessionTitleErrorCode(new Error('404 Session not found'))).toBe('not-found');
    expect(sessionTitleErrorCode(new Error('Failed to fetch'))).toBe('network');
    expect(sessionTitleErrorCode(new Error('boom'))).toBe('unknown');
  });

  it('turns an unknown failure into a readable message with the cause', () => {
    expect(sessionTitleErrorMessage(new Error('boom'))).toContain('boom');
    expect(sessionTitleErrorMessage(Object.assign(new Error('x'), { status: 404 }))).toBe(
      'This session no longer exists. Refresh and try again.',
    );
  });
});
