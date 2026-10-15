import { uiText as sourceText } from './ui-locale';
/** Read-only source preview: entering a discussion never submits a model turn. */
export function createKanbanDiscussionPreview(sdk: Record<string, any>) {
  const React = sdk.React;
  const { useEffect, useState } = sdk.hooks;
  const h = React.createElement;
  return function KanbanDiscussionPreview({ context, sessionId, empty, busy, onStart }: any) {
    const [state, setState] = useState({ loading: true, snapshot: null, error: '' } as any);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
      let active = true;
      setState({ loading: true, snapshot: null, error: '' });
      context.load(sdk.fetchJSON, sessionId).then((snapshot: any) => {
        if (!active || !context.matches(sessionId)) return;
        setState({ loading: false, snapshot, error: snapshot ? '' : sourceText("卡片关联已失效", "The card link is no longer valid") });
        const url = new URL(window.location.href);
        if (snapshot && url.searchParams.get('kanban_task') === snapshot.taskId
            && (url.searchParams.get('session') || '') === sessionId) {
          url.searchParams.set('kanban_board', snapshot.board);
          window.history.replaceState(null, '', url);
        }
      }).catch((error: unknown) => {
        if (active) setState({ loading: false, snapshot: null, error: String(error) });
      });
      return () => { active = false; };
    }, [context, sessionId, retry]);
    if (state.loading) return h('section', { className: 'codex-card-context', role: 'status' }, sourceText("正在读取卡片上下文…", "Loading card context…"));
    if (state.error) return h('section', { className: 'codex-card-context', role: 'alert' },
      h('strong', null, sourceText("卡片读取失败", "Failed to load card")), h('p', null, state.error),
      h('button', { type: 'button', onClick: () => setRetry((n: number) => n + 1) }, sourceText("重试读取卡片", "Retry loading card")));
    const snapshot = state.snapshot;
    if (!snapshot) return null;
    const { data, board, taskId } = snapshot;
    const cardURL = `/kanban?board=${encodeURIComponent(board)}`;
    return h('section', { className: 'codex-card-context', 'aria-label': sourceText("卡片讨论上下文", "Card discussion context") },
      h('div', { className: 'codex-card-context-meta' }, sourceText("卡片头脑风暴 · ", "Card brainstorm · "), h('a', { href: cardURL }, board), ` · ${taskId}`),
      h('h2', null, data.task.title || taskId),
      h('details', { open: empty },
        h('summary', null, sourceText("查看卡片原文", "View original card")),
        h('div', { className: 'codex-card-context-body' }, data.task.body || data.task.description || sourceText("这张卡片尚未填写正文，先围绕标题讨论。", "This card has no body yet. Start with its title.")),
        h('p', { className: 'codex-card-context-meta' }, sourceText(`备注 ${data.comments?.length || 0} · 运行记录 ${data.runs?.length || 0} · 附件 ${data.attachments?.length || 0}`, `Comments ${data.comments?.length || 0} · Runs ${data.runs?.length || 0} · Attachments ${data.attachments?.length || 0}`))),
      h('p', { className: 'codex-card-context-hint' }, sourceText("此处为卡片预览；首次发送仅传看板名、编号与讨论约束，由智能体读取最新详情。", "This is a card preview. The first message sends only its board, ID, and discussion constraints; the agent reads current details.")),
      empty ? h('div', { className: 'codex-card-context-start' },
        h('button', { type: 'button', className: 'codex-send', disabled: busy, onClick: onStart }, sourceText("开始头脑风暴", "Start brainstorming")),
        h('span', null, sourceText("也可以直接在下方输入你的想法。", "You can also type your ideas below."))) : null);
  };
}
