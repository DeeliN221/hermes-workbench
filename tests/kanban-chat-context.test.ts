import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createKanbanChatContext } from '../dashboard/src/kanban-chat-context';
vi.mock('../dashboard/src/kanban-session-api', () => ({ linkKanbanSession: vi.fn(async (_fetch, link) => link) }));
const search = '?kanban_task=t_715fea9c&kanban_board=Money&session=s1';
const cardFetch = () => vi.fn(async (url: string) => url.includes('/codex/session?') ? { turns: [] } : detail) as any;
const detail = { task: { id: 't_715fea9c', title: 'wealthbook 原文', description: '每月导入' }, comments: [{ content: '保留来源' }], runs: [], attachments: [{ name: 'a.xlsx' }] };
describe('Kanban chat context delivery', () => {
  it('recognizes prior injected context after reopening, including the pre-fix session', async () => {
    const context = createKanbanChatContext(search, 's1', true);
    const fetch = vi.fn(async () => ({ turns: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: '【看板讨论上下文】\n来源：/api/plugins/kanban/tasks/t_715fea9c?board=Money\n【用户当前消息】开始' }] }] }] })) as any;
    expect(await context.message(fetch, 's1', '继续', { profile: 'finance-advisor' })).toBe('继续');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('profile=finance-advisor');
  });
  it('sends only the locator and constraints once; writeback requests a fresh native read', async () => {
    const context = createKanbanChatContext(search, 's1', true);
    const fetch = cardFetch();
    const result = await context.message(fetch, 's1', '能看到吗');
    expect(fetch.mock.calls.every(([url]: string[]) => !url.includes('/kanban/tasks/'))).toBe(true);
    expect(result).toContain('"board":"Money","task_id":"t_715fea9c"');
    expect(result).toContain('kanban_show');
    expect(result).toContain('worker_context');
    expect(result).not.toContain('wealthbook 原文');
    expect(result).not.toContain('保留来源');
    expect(result).not.toContain('a.xlsx');
    expect(result).toContain('不代表授权执行');
    expect(result).toContain('默认每次回答不超过200字');
    expect(result).toContain('紧凑表格');
    expect(result).toContain('Mermaid');
    expect(result).toContain('不设置为全局偏好');
    expect(result).toContain('【用户当前消息】\n能看到吗');
    // Until accepted, retry must still carry context.
    expect(await context.message(fetch, 's1', '重试')).toContain('【看板讨论上下文】');
    context.acknowledge('s1', result);
    fetch.mockClear();
    expect(await context.message(fetch, 's1', '继续')).toBe('继续');
    expect(fetch).not.toHaveBeenCalled();
    const refresh = context.writebackRequest('s1', 'finance-advisor');
    expect(refresh).toContain('重新读取最新卡片');
    expect(refresh).toContain('"board":"Money","task_id":"t_715fea9c"');
    expect(await context.message(fetch, 's1', refresh)).toBe(refresh);
    expect(fetch).not.toHaveBeenCalled();
    const reopened = createKanbanChatContext(search, 's1', true);
    const history = vi.fn(async () => ({ turns: [{ items: [{ type: 'userMessage', content: [{ text: result }] }] }] })) as any;
    expect(await reopened.message(history, 's1', '再次打开')).toBe('再次打开');
  });
  it('binds a new discussion before navigation and continues delivering context', async () => {
    const context = createKanbanChatContext('?kanban_task=t_715fea9c&kanban_board=Money', '', true);
    await context.bind(vi.fn() as any, 'default', '', 'new');
    expect(context.matches('new')).toBe(true);
    expect(context.matches('')).toBe(false);
  });
  it('does not leak card content to other panes or sessions', async () => {
    const fetch = vi.fn() as any;
    for (const context of [createKanbanChatContext(search, 's1', false), createKanbanChatContext(search, 's2', true)]) {
      expect(await context.message(fetch, 's1', 'hello')).toBe('hello');
    }
    const context = createKanbanChatContext(search, 's1', true);
    expect(await context.message(fetch, 's2', 'hello')).toBe('hello');
    context.clear();
    expect(await context.message(fetch, 's1', 'hello')).toBe('hello');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not mark failed history or board reads delivered', async () => {
    const context = createKanbanChatContext(search, 's1', true);
    await expect(context.message((async () => ({})) as any, 's1', 'hello')).rejects.toThrow('消息尚未发送');
    expect(await context.message(cardFetch(), 's1', '重试')).toContain('kanban_show');
    const legacy = createKanbanChatContext('?kanban_task=t1', '', true);
    await expect(legacy.message((async () => ({})) as any, '', '开始')).rejects.toThrow('无法确定');
  });
  it('requests preview and explicit confirmation with an unambiguous source session', () => {
    const context = createKanbanChatContext(search, 's1', true);
    const prompt = context.writebackRequest('s1', 'default');
    for (const text of ['不授权保存', '保留原始需求', '验收标准', '待决问题', '先合并并重新展示预览', '不派发', '回读核验', 'session=s1', 'kanban_board=Money']) {
      expect(prompt).toContain(text);
    }
    expect(context.writebackRequest('another', 'default')).toBe('');
    expect(createKanbanChatContext('?kanban_task=t1', '', true).writebackRequest('', 'default')).toBe('');
    expect(createKanbanChatContext('?session=s1', 's1', true).writebackRequest('s1', 'default')).toBe('');
    context.clear();
    expect(context.writebackRequest('s1', 'default')).toBe('');
  });

  it('resolves legacy links once and pins the board for preview and subsequent messages', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/boards') ? { current: 'Money' } : detail) as any;
    const context = createKanbanChatContext('?kanban_task=t_715fea9c', '', true);
    expect((await context.load(fetch, ''))?.board).toBe('Money');
    await context.message(fetch, '', '开始');
    expect(fetch.mock.calls.filter(([url]: string[]) => url.endsWith('/boards'))).toHaveLength(1);
    expect(fetch).toHaveBeenLastCalledWith('/api/plugins/kanban/tasks/t_715fea9c?board=Money');
    expect(context.startRequest('')).toContain('一个最值得澄清的问题');
    expect(context.startRequest('another')).toBe('');
  });
  it('honors the browser selected board when the legacy URL omits it', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'browser-board' } });
    try {
      const context = createKanbanChatContext('?kanban_task=t_715fea9c', '', true);
      const fetch = cardFetch();
      await context.load(fetch, '');
      expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/plugins/kanban/tasks/t_715fea9c?board=browser-board');
      expect(await context.load(fetch, 'other')).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

});

// These assertions exercise the retained Chinese translation explicitly.
beforeEach(() => vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } }));
afterEach(() => vi.unstubAllGlobals());
