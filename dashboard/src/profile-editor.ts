import { uiText } from './ui-locale';
import { agentDisplayName } from './kanban-agent-picker';
import type { FetchJSON } from './workbench-api';

export type ProfileRow = { name: string; description?: string; model?: string; provider?: string; display_name?: string };
export type EditorTab = 'description' | 'soul' | 'model';
export type ProviderOption = { slug: string; name?: string; authenticated?: boolean; models?: string[] };
export type ModelOptions = { providers: ProviderOption[]; provider?: string; model?: string };

/** Only the scoped, authenticated inventory may populate the model picker. */
export function configuredProviders(data: ModelOptions): ProviderOption[] {
  if (!Array.isArray(data.providers)) throw new Error(uiText('模型列表格式异常', 'Invalid model options response'));
  return data.providers.filter(row => row.authenticated === true && typeof row.slug === 'string' && !!row.slug.trim())
    .map(row => ({ ...row, models: [...new Set((row.models || []).filter(model => typeof model === 'string' && !!model.trim()))] }));
}

export function createProfileEditor(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }) {
  const { createElement: h } = sdk.React;
  const { useState, useEffect, useRef } = sdk.hooks;
  return function ProfileEditor({ row, tab, onClose, onSaved }: {
    row: ProfileRow; tab: EditorTab; onClose: () => void; onSaved: () => void;
  }) {
    const dialog = useRef(null as HTMLDialogElement | null);
    const alive = useRef(true);
    const [activeTab, setActiveTab] = useState(tab);
    const [text, setText] = useState(row.description || '');
    const [providers, setProviders] = useState([] as ProviderOption[]);
    const [provider, setProvider] = useState('');
    const [model, setModel] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [loadFailed, setLoadFailed] = useState(false);
    const [epoch, setEpoch] = useState(0);
    const endpoint = `/api/profiles/${encodeURIComponent(row.name)}`;
    useEffect(() => {
      alive.current = true;
      dialog.current?.showModal();
      return () => { alive.current = false; dialog.current?.close(); };
    }, []);
    useEffect(() => {
      const controller = new AbortController();
      setLoading(true); setError(''); setLoadFailed(false);
      const load = async () => {
        if (activeTab === 'description') { setText(row.description || ''); return; }
        if (activeTab === 'soul') {
          const data = await sdk.fetchJSON<{ content: string }>(`${endpoint}/soul`, { signal: controller.signal });
          if (!controller.signal.aborted) setText(data.content);
          return;
        }
        const data = await sdk.fetchJSON<ModelOptions>(`/api/model/options?profile=${encodeURIComponent(row.name)}`, { signal: controller.signal });
        const available = configuredProviders(data);
        if (controller.signal.aborted) return;
        setProviders(available);
        const current = available.find(p => p.slug === (data.provider || row.provider));
        setProvider(current?.slug || '');
        setModel(data.model || row.model || '');
      };
      void load().catch(e => { if (!controller.signal.aborted) { setError(String(e)); setLoadFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      return () => controller.abort();
    }, [activeTab, epoch]);
    async function save(event: Event) {
      event.preventDefault();
      if (busy || loading || loadFailed) return;
      if (activeTab === 'model' && (!providers.some((p: ProviderOption) => p.slug === provider) || !model.trim())) return;
      setBusy(true); setError('');
      const body = activeTab === 'model' ? { provider, model: model.trim() } : activeTab === 'soul' ? { content: text } : { description: text.trim() };
      try {
        const result = await sdk.fetchJSON<{ ok: boolean }>(`${endpoint}/${activeTab}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!result.ok) throw new Error(uiText('服务器未确认保存成功', 'The server did not confirm the save'));
        onSaved();
        if (alive.current) onClose();
      } catch (e) { if (alive.current) setError(String(e)); }
      finally { if (alive.current) setBusy(false); }
    }
    const title = uiText('编辑档案', 'Edit profile');
    const models = providers.find((p: ProviderOption) => p.slug === provider)?.models || [];
    return h('dialog', { ref: dialog, className: 'workbench-profile-editor', 'aria-label': `${title}: ${agentDisplayName(row.name)}`,
      onCancel: (event: Event) => { event.preventDefault(); if (!busy) onClose(); },
    }, h('header', null, h('h2', null, `${title}: ${agentDisplayName(row.name)}`),
      h('button', { type: 'button', disabled: busy, 'aria-label': uiText('关闭编辑', 'Close editor'), onClick: onClose }, '×')),
      h('nav', { 'aria-label': uiText('档案编辑内容', 'Profile editor sections') },
        (['description', 'model', 'soul'] as EditorTab[]).map(section => h('button', {
          key: section, type: 'button', disabled: busy, 'aria-pressed': activeTab === section,
          onClick: () => setActiveTab(section),
        }, section === 'description' ? uiText('说明', 'Description') : section === 'model' ? uiText('默认模型', 'Default model') : 'SOUL.md'))),
      h('form', { onSubmit: save },
        loading ? h('p', { role: 'status' }, uiText('正在读取…', 'Loading…')) : null,
        error ? h('p', { role: 'alert' }, error, ' ', h('button', { type: 'button', disabled: busy, onClick: () => { setError(''); if (loadFailed) setEpoch((n: number) => n + 1); } }, uiText('重试', 'Retry'))) : null,
        !loading && activeTab === 'model' ? h('div', { className: 'workbench-profile-model-fields' },
          h('p', null, uiText('网页对话通过 Codex 接口运行；兼容该接口的提供商（例如 DeepSeek）可以继续配置。Claude 和 Pi 会话仅可从终端启动并在历史中查看。', 'Web chats use the Codex interface; compatible providers such as DeepSeek can still be configured. Claude and Pi sessions are terminal-only and history can be viewed here.')),
          providers.length ? h('label', null, uiText('提供商', 'Provider'), h('select', { 'aria-label': uiText('提供商', 'Provider'), value: provider, disabled: busy, onChange: (event: any) => { const value = event.target.value; setProvider(value); setModel(providers.find((p: ProviderOption) => p.slug === value)?.models?.[0] || ''); } },
            !provider ? h('option', { value: '', disabled: true }, uiText('请选择已配置的提供商', 'Select a configured provider')) : null,
            providers.map((p: ProviderOption) => h('option', { key: p.slug, value: p.slug }, p.name || p.slug)))) : h('p', null, uiText('此档案没有已配置的模型提供商，请先完成提供商配置。', 'No configured providers for this profile. Configure a provider first.')),
          providers.length ? h('label', null, uiText('模型', 'Model'), h('input', {
            'aria-label': uiText('模型', 'Model'), role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': false,
            list: 'workbench-profile-model-options', value: model, required: true, disabled: busy,
            onChange: (event: any) => setModel(event.target.value), autoComplete: 'off',
          }), h('datalist', { id: 'workbench-profile-model-options' }, models.map((m: string) => h('option', { key: m, value: m })))) : null,
        ) : null,
        !loading && activeTab !== 'model' ? h('label', null, activeTab === 'soul' ? 'SOUL.md' : uiText('说明', 'Description'), h('textarea', {
          value: text, rows: activeTab === 'soul' ? 16 : 5, disabled: busy || loadFailed, onChange: (event: any) => setText(event.target.value),
        })) : null,
        h('footer', null, h('button', { type: 'button', disabled: busy, onClick: onClose }, uiText('取消', 'Cancel')),
          h('button', { type: 'submit', disabled: loading || busy || loadFailed || activeTab === 'model' && (!provider || !model.trim()) }, busy ? uiText('保存中…', 'Saving…') : uiText('保存', 'Save')))));
  };
}
