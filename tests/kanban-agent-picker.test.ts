// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { agentDisplayName, loadKanbanProfiles, populateKanbanAgentSelect } from '../dashboard/src/kanban-agent-picker';

describe('Kanban installed agent selector', () => {
  it('uses the live locale without repeating English profile names', () => {
    const original = document.documentElement.lang;
    try {
      document.documentElement.lang = 'en';
      expect(agentDisplayName('default')).toBe('default');
      expect(agentDisplayName('career-coach')).toBe('career-coach');
      document.documentElement.lang = 'zh';
      expect(agentDisplayName('career-coach')).toBe('career-coach（就业导师）');
      expect(agentDisplayName('custom-agent')).toBe('custom-agent');
      document.documentElement.lang = 'en';
      expect(agentDisplayName('career-coach')).toBe('career-coach');
    } finally { document.documentElement.lang = original; }
  });
  it('resolves the board/task preference before enabling handoff', async () => {
    const select = document.createElement('select');
    const actions = [document.createElement('button')];
    const host = document.createElement('section');
    await populateKanbanAgentSelect(select, actions, host, async () => ['default', 'health-advisor'], async () => 'health-advisor');
    expect(select.value).toBe('health-advisor');
    expect(actions[0].disabled).toBe(false);
  });
  it('blocks handoff when the configured profile disappeared', async () => {
    const select = document.createElement('select');
    const actions = [document.createElement('button')];
    const host = document.createElement('section');
    await populateKanbanAgentSelect(select, actions, host, async () => ['default'], async () => 'health-advisor');
    expect(select.value).toBe('');
    expect(actions[0].disabled).toBe(true);
    expect(host.textContent).toContain('health-advisor');
  });
  it('uses all installed names and never substitutes a fake default roster on invalid data', async () => {
    const names = ['default','career-coach','finance-advisor','health-advisor','learning-mentor','project-manager','social-advisor','travel-assistant','writer'];
    expect(await loadKanbanProfiles(vi.fn(async () => ({ profiles: names.map(name => ({ name })) })) as any, '/profiles')).toEqual(names);
    for (const payload of [{}, {profiles:[]}, {profiles:'wrong'}]) {
      await expect(loadKanbanProfiles(vi.fn(async () => payload) as any, '/profiles')).rejects.toThrow();
    }
  });
  it('blocks handoff during loading/failure and allows retry without assigning default', async () => {
    const select = document.createElement('select');
    const actions = [document.createElement('button'), document.createElement('button')];
    const host = document.createElement('section');
    const load = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce(['default','writer']);
    await populateKanbanAgentSelect(select, actions, host, load);
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('');
    expect(actions.every(b => b.disabled)).toBe(true);
    expect(host.textContent).toContain('HTTP 503');
    host.querySelector('button')!.click();
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(Array.from(select.options).map(o => o.value)).toEqual(['default','writer']);
    expect(actions.every(b => !b.disabled)).toBe(true);
    expect(host.querySelector<HTMLElement>('[role=status]')?.hidden).toBe(true);
  });
});
