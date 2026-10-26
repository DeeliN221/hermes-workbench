import { uiText } from './ui-locale';
import { agentDisplayName, profileTabName } from './kanban-agent-picker';
import { rememberChat, switchProfile } from './profile-scope';
import type { FetchJSON } from './workbench-api';
import { craftingIcon } from './crafting-icons';
import { createProfileEditor, type ProfileRow, type EditorTab } from './profile-editor';

type Profile = ProfileRow;
type SDK = { React: any; hooks: any; fetchJSON: FetchJSON };
const CHANGED = 'workbench:profiles-changed';

export function createProfileControls(sdk: SDK) {
  const { createElement: h } = sdk.React;
  const { useState, useEffect, useRef } = sdk.hooks;
  const ProfileEditor = createProfileEditor(sdk);
  let rosterRequest: Promise<{ profiles: Profile[] }> | null = null;
  function useProfiles() {
    const [rows, setRows] = useState(null as Profile[] | null);
    const [error, setError] = useState('');
    const [epoch, setEpoch] = useState(0);
    useEffect(() => {
      let live = true;
      setError('');
      (rosterRequest ||= sdk.fetchJSON<{ profiles: Profile[] }>('/api/profiles')).then(data => {
        if (!Array.isArray(data.profiles)) throw new Error(uiText("配置档案列表格式异常", "Invalid profile list response"));
        if (live) setRows(data.profiles);
      }).catch(error => { if (live) setError(String(error)); });
      return () => { live = false; };
    }, [epoch]);
    useEffect(() => {
      const refresh = () => { rosterRequest = null; setEpoch((n: number) => n + 1); };
      window.addEventListener(CHANGED, refresh);
      window.addEventListener('popstate', refresh);
      return () => { window.removeEventListener(CHANGED, refresh); window.removeEventListener('popstate', refresh); };
    }, []);
    return { rows, error, retry: () => { rosterRequest = null; setEpoch((n: number) => n + 1); } };
  }
  function ProfileAction({ profile, label, className }: { profile: string; label?: string; className?: string }) {
    const { rows, error, retry } = useProfiles();
    const [open, setOpen] = useState(false);
    const [switchError, setSwitchError] = useState('');
    const [failedProfile, setFailedProfile] = useState('');
    const root = useRef(null as HTMLDivElement | null);
    const trigger = useRef(null as HTMLButtonElement | null);
    const current = profileTabName(profile);
    useEffect(() => { setOpen(false); }, [profile]);
    useEffect(() => {
      const failed = (event: CustomEvent) => setSwitchError(event.detail?.message || uiText("档案切换失败，请重试。", "Profile switch failed. Please retry."));
      window.addEventListener('workbench:profile-error', failed as EventListener);
      return () => window.removeEventListener('workbench:profile-error', failed as EventListener);
    }, []);
    useEffect(() => {
      if (!open) return undefined;
      const outside = (event: Event) => {
        if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      };
      document.addEventListener('pointerdown', outside);
      document.addEventListener('keydown', escape);
      return () => {
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape);
      };
    }, [open]);
    const choose = (name: string) => {
      setOpen(false);
      setSwitchError('');
      setFailedProfile('');
      try {
        if (name !== profile) switchProfile(name);
      } catch (error) {
        setFailedProfile(name);
        setSwitchError(uiText(`档案切换失败：${String(error)}`, `Profile switch failed: ${String(error)}`));
      }
    };
    const unavailable = Boolean(rows && !rows.some((row: Profile) => row.name === profile));
    return h('div', { className: `workbench-profile-action${className ? ` ${className}` : ''}`, ref: root },
      h('button', {
        type: 'button', ref: trigger, 'aria-label': uiText("切换 profile", "Switch profile"),
        'aria-haspopup': 'menu', 'aria-expanded': String(open), 'aria-controls': 'workbench-profile-menu',
        title: uiText(`切换 profile：${agentDisplayName(profile)}`, `Switch profile: ${agentDisplayName(profile)}`),
        onClick: () => setOpen((value: boolean) => !value),
      }, craftingIcon(sdk.React, 'profile'), h('span', null, label || current || uiText("切换 profile", "Switch profile")),
        h('svg', { className: 'workbench-profile-chevron', viewBox: '0 0 24 24', width: 14, height: 14,
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'm6 9 6 6 6-6' }))),
      open ? h('div', { id: 'workbench-profile-menu', className: 'workbench-profile-menu', role: 'menu',
        'aria-label': uiText("切换 profile", "Switch profile") },
        !rows && !error ? h('p', { className: 'workbench-profile-menu-status', role: 'status' }, uiText("正在读取配置档案…", "Loading profiles…")) : null,
        rows?.map((row: Profile) => h('button', {
          key: row.name, type: 'button', role: 'menuitemradio', 'aria-checked': String(row.name === profile),
          className: row.name === profile ? 'is-current' : '', onClick: () => choose(row.name),
        }, h('span', { className: 'workbench-profile-option-label', title: row.name }, profileTabName(row.name)),
          row.name === profile ? h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none',
            stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'm5 12 4 4L19 6' })) : null)),
        unavailable ? h('p', { className: 'workbench-profile-menu-status' }, uiText(`${profile}（不可用）`, `${profile} (unavailable)`)) : null,
        switchError ? h('div', { className: 'workbench-profile-menu-error', role: 'alert' }, switchError,
          failedProfile ? h('button', { type: 'button', onClick: () => choose(failedProfile) }, uiText("重试", "Retry")) : null) : null,
        error ? h('div', { className: 'workbench-profile-menu-error', role: 'alert' }, uiText("档案加载失败 ", "Failed to load profiles "),
          h('button', { type: 'button', onClick: retry }, uiText("重试", "Retry"))) : null) : null);
  }
  function ProfilesPage({ profile }: { profile: string }) {
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const { rows, error, retry } = useProfiles();
    const readEditor = () => {
      const query = new URLSearchParams(window.location.search);
      const name = query.get('edit');
      const section = query.get('section');
      return name ? { name, tab: (section === 'model' || section === 'soul' ? section : 'description') as EditorTab } : null;
    };
    const [editor, setEditor] = useState(readEditor);
    useEffect(() => {
      const refresh = () => setEditor(readEditor());
      window.addEventListener('popstate', refresh);
      return () => window.removeEventListener('popstate', refresh);
    }, []);
    const closeEditor = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('edit'); url.searchParams.delete('section');
      window.history.replaceState(null, '', url);
      setEditor(null);
    };
    const editingRow = rows?.find((row: Profile) => row.name === editor?.name);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [source, setSource] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [failed, setFailed] = useState(false);
    async function create(andSwitch: boolean) {
      if (busy) return;
      setFailed(false); setNotice('');
      const normalized = name.trim();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
        setFailed(true); setNotice(uiText("名称需为小写字母、数字、横线或下划线，最长 64 字符。", "Use lowercase letters, numbers, hyphens or underscores, up to 64 characters.")); return;
      }
      if (rows?.some((p: Profile) => p.name === normalized)) {
        setFailed(true); setNotice(uiText("此配置档案已存在，请换一个名称。", "This profile already exists. Choose another name.")); return;
      }
      setBusy(true);
      try {
        const result = await sdk.fetchJSON<{ ok: boolean; name: string }>('/api/profiles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: normalized, description: description.trim(), clone_from: source || null, clone_from_default: false }),
        });
        if (!result.ok) throw new Error(uiText("服务器未确认创建成功", "The server did not confirm creation"));
        setCreating(false); setName(''); setDescription(''); setSource('');
        setNotice(uiText(`已创建 ${result.name}`, `Created ${result.name}`));
        window.dispatchEvent(new Event(CHANGED));
        if (andSwitch && mounted.current) switchProfile(result.name);
      } catch (error) { setFailed(true); setNotice(uiText(`创建失败：${String(error)}`, `Creation failed: ${String(error)}`)); }
      finally { setBusy(false); }
    }
    const link = (path: string, name: string, label: string) => h('a', {
      href: `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(name)}`,
      onClick: (event: any) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
        event.preventDefault();
        const href = event.currentTarget.href;
        if (!window.dispatchEvent(new CustomEvent('workbench:before-navigate', { cancelable: true, detail: { path: href, profile: name } }))) return;
        rememberChat();
        window.history.pushState(null, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
    }, label);
    return h('section', { className: 'workbench-profiles', 'aria-label': uiText("配置档案管理", "Manage profiles") },
      h('header', null, h('div', null, h('h1', null, uiText("配置档案", "Profiles")), h('p', null, uiText("切换对话空间，分别管理会话与配置。", "Switch conversation spaces with separate sessions and settings."))),
        h('button', { type: 'button', onClick: () => setCreating(!creating), disabled: busy }, creating ? uiText("收起新建", "Cancel creation") : uiText("新建配置档案", "New profile"))),
      creating ? h('form', { className: 'workbench-profile-create', onSubmit: (e: Event) => { e.preventDefault(); void create(true); } },
        h('h2', null, uiText("新建配置档案", "New profile")),
        h('label', null, uiText("名称", "Name"), h('input', { name: 'profile-name', value: name, onChange: (e: any) => setName(e.target.value), required: true, maxLength: 64, autoFocus: true, disabled: busy, placeholder: uiText("例如 coder", "For example, coder") })),
        h('label', null, uiText("说明（可选）", "Description (optional)"), h('textarea', { name: 'profile-description', value: description, onChange: (e: any) => setDescription(e.target.value), disabled: busy })),
        h('label', null, uiText("初始配置", "Initial settings"), h('select', { name: 'source-profile', value: source, onChange: (e: any) => setSource(e.target.value), disabled: busy },
          h('option', { value: '' }, uiText("使用基础配置", "Use base settings")),
          rows?.map((p: Profile) => h('option', { key: p.name, value: p.name }, uiText(`复制 ${agentDisplayName(p.name)} 的配置`, `Copy settings from ${agentDisplayName(p.name)}`))))),
        h('p', null, uiText("仅复制配置，不复制会话。模型、技能和工具可在创建后编辑。", "Only settings are copied, not sessions. Edit models, skills and tools after creation.")),
        h('div', { className: 'workbench-profile-actions' },
          h('button', { type: 'submit', disabled: busy }, busy ? uiText("创建中…", "Creating\u2026") : uiText("创建并切换", "Create and switch")),
          h('button', { type: 'button', disabled: busy, onClick: () => void create(false) }, uiText("仅创建", "Create only")),
          link('/profiles/new', profile, uiText("高级创建向导", "Advanced setup")))) : null,
      notice ? h('p', { role: failed ? 'alert' : 'status' }, notice) : null,
      error ? h('p', { role: 'alert' }, uiText(`无法加载配置档案：${error} `, `Failed to load profiles: ${error} `), h('button', { onClick: retry }, uiText("重试", "Retry"))) : null,
      !rows && !error ? h('p', { role: 'status' }, uiText("正在读取配置档案…", "Loading profiles\u2026")) : null,
      rows?.length === 0 ? h('p', null, uiText("暂无配置档案，请先新建。", "No profiles yet. Create one to begin.")) : null,
      h('div', { className: 'workbench-profile-grid' }, rows?.map((row: Profile) => h('article', {
        key: row.name, className: 'workbench-profile-card', 'data-current': row.name === profile, 'data-profile': row.name,
      }, h('header', null, h('h2', null, agentDisplayName(row.name)), row.name === profile ? h('span', { className: 'workbench-profile-badge' }, uiText("当前", "Current")) : null),
        h('p', null, row.description || uiText("暂无说明", "No description")),
        h('small', null, row.model || uiText("使用档案默认模型", "Use the profile default model")),
        h('div', { className: 'workbench-profile-actions' },
          h('button', { type: 'button', disabled: row.name === profile, onClick: () => switchProfile(row.name) }, row.name === profile ? uiText("使用中", "In use") : uiText("切换到此档案", "Switch to this profile")),
          link(`/profiles?edit=${encodeURIComponent(row.name)}`, profile, uiText("编辑", "Edit")),
          link(`/profiles?edit=${encodeURIComponent(row.name)}&section=model`, profile, uiText("模型", "Models")), link('/skills', row.name, uiText("技能", "Skills")))))),
      editor && editingRow ? h(ProfileEditor, { key: `${editor.name}:${editor.tab}`, row: editingRow, tab: editor.tab,
        onClose: closeEditor, onSaved: () => window.dispatchEvent(new Event(CHANGED)),
      }) : editor && rows ? h('p', { role: 'alert' }, uiText('找不到要编辑的档案。', 'The profile to edit was not found.'), h('button', { onClick: closeEditor }, uiText('关闭', 'Close'))) : null,
      h('p', { className: 'workbench-profile-hint' }, uiText("当前选择仅保存在本浏览器标签页；切换不会更改 CLI、网关默认档案或中断后台任务。", "Your selection is local to this browser tab. Switching does not change CLI or gateway defaults or interrupt background tasks.")));
  }
  return { ProfileAction, ProfilesPage };
}
