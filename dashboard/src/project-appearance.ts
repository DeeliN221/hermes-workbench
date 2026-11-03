import { createCodexGroup, styleCodexGroup } from './codex-api';
import { uiText as tr } from './ui-locale';
import './project-appearance.css';

export const projectColors: Record<string, string> = { blue: '#548de5', green: '#339b72', amber: '#bc851b', purple: '#a177d4', rose: '#d4688b' };
export const projectIcons: Record<string, string> = { folder: '▰', code: '⌘', book: '▤', star: '☆', flask: '⚗' };
export function projectMark(h: any, project: { color?: string; icon?: string }) {
  return h('span', { className: 'project-appearance-mark', style: { color: projectColors[project.color || ''] }, 'aria-hidden': true }, project.icon && project.icon !== 'folder' ? projectIcons[project.icon] || '▰' : h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }, h('path', { d: 'M3 7V5h6l2 2h10v13H3z' })));
}

/** A native modal supplies focus containment, Escape, and focus restoration. */
export function createProjectEditor(sdk: any) {
  const h = sdk.React.createElement;
  return function ProjectEditor({ profile, project, onSaved, onClose }: any) {
    const [name, setName] = sdk.hooks.useState('');
    const [color, setColor] = sdk.hooks.useState(project?.color || '');
    const [icon, setIcon] = sdk.hooks.useState(project?.icon || '');
    const [busy, setBusy] = sdk.hooks.useState(false);
    const [error, setError] = sdk.hooks.useState('');
    const ref = sdk.hooks.useRef(null);
    sdk.hooks.useEffect(() => { ref.current?.showModal(); }, []);
    const save = async (event: Event) => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError('');
      try {
        const saved = project ? await styleCodexGroup(sdk.fetchJSON, profile, project.id, color, icon) : await createCodexGroup(sdk.fetchJSON, profile, name.trim());
        onSaved(saved); onClose();
      } catch { setError(tr('保存失败，请重试', 'Unable to save. Please retry.')); }
      finally { setBusy(false); }
    };
    return h('dialog', { ref, className: 'project-editor', 'aria-label': project ? tr('项目外观', 'Project appearance') : tr('新建项目', 'New project'), onCancel: (e: Event) => { e.preventDefault(); if (!busy) onClose(); } },
      h('form', { onSubmit: save },
        h('h3', null, project ? projectMark(h, { color, icon }) : null, project ? project.name : tr('新建项目', 'New project')),
        project ? h('div', { className: 'project-editor-options' },
          h('label', null, tr('颜色', 'Color'), h('select', { 'aria-label': tr('颜色', 'Color'), value: color, onChange: (e: any) => setColor(e.target.value) },
            h('option', { value: '' }, tr('默认', 'Default')), ...Object.keys(projectColors).map(value => h('option', { value, key: value }, value)))),
          h('label', null, tr('图标', 'Icon'), h('select', { 'aria-label': tr('图标', 'Icon'), value: icon, onChange: (e: any) => setIcon(e.target.value) },
            h('option', { value: '' }, tr('默认', 'Default')), ...Object.entries(projectIcons).map(([value, glyph]) => h('option', { value, key: value }, glyph + ' ' + value)))))
          : h('label', null, tr('项目名称', 'Project name'), h('input', { autoFocus: true, required: true, maxLength: 60, value: name, onChange: (e: any) => setName(e.target.value) })),
        error ? h('p', { role: 'alert' }, error) : null,
        h('footer', null, h('button', { type: 'button', disabled: busy, onClick: onClose }, tr('取消', 'Cancel')),
          h('button', { type: 'submit', disabled: busy || (!project && !name.trim()) }, busy ? tr('保存中…', 'Saving…') : tr('保存', 'Save')))));
  };
}
