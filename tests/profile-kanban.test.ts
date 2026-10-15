import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { profileBoard } from '../dashboard/src/profile-kanban';

describe('profile board navigation', () => {
  const boards = [
    { slug: 'default', default_assignee: 'default' },
    { slug: 'health', default_assignee: 'health-advisor' },
    { slug: 'money', default_assignee: 'finance-advisor' },
    { slug: 'writing', default_assignee: 'writer' },
  ];
  it('uses board metadata rather than assuming a profile name is a board slug', () => {
    expect(profileBoard(boards, 'health-advisor')).toBe('health');
    expect(profileBoard(boards, 'finance-advisor')).toBe('money');
    expect(profileBoard(boards, 'writer')).toBe('writing');
    expect(profileBoard(boards, 'default')).toBe('default');
  });
  it('does not silently use default for missing, archived, or ambiguous boards', () => {
    expect(() => profileBoard(boards, 'project-manager')).toThrow('未找到');
    expect(() => profileBoard([{ ...boards[1], archived: true }], 'health-advisor')).toThrow('未找到');
    expect(() => profileBoard([...boards, { slug: 'other', default_assignee: 'writer' }], 'writer')).toThrow('多个');
  });
});

// These assertions exercise the retained Chinese translation explicitly.
beforeEach(() => vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } }));
afterEach(() => vi.unstubAllGlobals());
