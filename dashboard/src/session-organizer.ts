import { uiText as sourceText } from './ui-locale';
/**
 * Provide an editor for session display names, collections, tags, pinning, and manual summaries.
 * Write only Workbench metadata; leave original Hermes session content untouched.
 */
import { saveSessionOrganization } from './session-organization-api';
import type { SessionOrganization } from './session-organization';

type SDK = Record<string, any>;

export interface SessionOrganizerProps {
  nativeSessionTitle: string;
  value: SessionOrganization;
  collections: string[];
  onClose: () => void;
  onSaved: (value: SessionOrganization | null, sessionId: string) => void;
}

/** Create one host-React element without bundling a second React runtime. */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** Convert the comma-oriented field into bounded unique tags before backend validation. */
export function parseTagInput(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[,，]/).flatMap((raw): string[] => {
    const tag = raw.trim();
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return [];
    seen.add(key);
    return [tag];
  }).slice(0, 8);
}

/** Build the modal component against the SDK-provided React and authenticated fetch client. */
export function createSessionOrganizer(sdk: SDK): (props: SessionOrganizerProps) => any {
  const React = sdk.React;
  const { useState } = sdk.hooks;

  return function SessionOrganizer({
    nativeSessionTitle,
    value,
    collections,
    onClose,
    onSaved,
  }: SessionOrganizerProps): any {
    /** Edit all organization fields, then update the sidebar after one save without refreshing transcript content. */
    const [displayName, setDisplayName] = useState(value.displayName);
    const [collection, setCollection] = useState(value.collection);
    const [tagText, setTagText] = useState(value.tags.join(', '));
    const [pinned, setPinned] = useState(value.pinned);
    const [summary, setSummary] = useState(value.summary);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    /** Persist the complete form so a clear field also clears its stored value. */
    const save = async () => {
      setSaving(true);
      setError('');
      try {
        const saved = await saveSessionOrganization(sdk.fetchJSON, {
          ...value,
          displayName: String(displayName || '').trim(),
          collection: String(collection || '').trim(),
          tags: parseTagInput(String(tagText || '')),
          pinned: Boolean(pinned),
          summary: String(summary || '').trim(),
        });
        onSaved(saved, value.sessionId);
        onClose();
      } catch (reason) {
        setError(String(reason));
      } finally {
        setSaving(false);
      }
    };

    return element(React, 'div', {
      className: 'hti-organizer-backdrop',
      role: 'presentation',
      onMouseDown: (event: any) => {
        if (event.target === event.currentTarget && !saving) onClose();
      },
    }, element(React, 'section', {
      className: 'hti-organizer-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'hti-organizer-title',
    },
    element(React, 'header', { className: 'hti-organizer-header' },
      element(React, 'div', null,
        element(React, 'span', null, sourceText("会话组织 / ORGANIZE SESSION", "ORGANIZE SESSION")),
        element(React, 'strong', { id: 'hti-organizer-title' }, displayName || nativeSessionTitle)),
      element(React, 'button', {
        type: 'button',
        onClick: onClose,
        disabled: saving,
        'aria-label': sourceText("关闭 / Close", "Close"),
      }, '×')),
    element(React, 'div', { className: 'hti-organizer-fields' },
      element(React, 'label', { htmlFor: 'hti-organizer-display-name' }, sourceText("显示名称（左侧标题） / Display name", "Display name")),
      element(React, 'input', {
        id: 'hti-organizer-display-name',
        value: displayName,
        maxLength: 120,
        placeholder: sourceText(`留空则显示：${nativeSessionTitle}`, `Leave empty to display: ${nativeSessionTitle}`),
        onChange: (event: any) => setDisplayName(event.target.value),
      }),
      element(React, 'label', { htmlFor: 'hti-organizer-collection' }, sourceText("项目集合 / Collection", "Collection")),
      element(React, 'input', {
        id: 'hti-organizer-collection',
        list: 'hti-organizer-collection-options',
        value: collection,
        maxLength: 80,
        placeholder: sourceText("例如：Hermes Workbench", "For example: Hermes Workbench"),
        onChange: (event: any) => setCollection(event.target.value),
      }),
      element(React, 'datalist', { id: 'hti-organizer-collection-options' },
        ...collections.map(name => element(React, 'option', { key: name, value: name }))),
      element(React, 'label', { htmlFor: 'hti-organizer-tags' }, sourceText("标签 / Tags", "Tags")),
      element(React, 'input', {
        id: 'hti-organizer-tags',
        value: tagText,
        maxLength: 272,
        placeholder: sourceText("插件, UI, 部署（最多 8 个）", "plugins, UI, deployment (up to 8)"),
        onChange: (event: any) => setTagText(event.target.value),
      }),
      element(React, 'label', { htmlFor: 'hti-organizer-summary' }, sourceText("会话摘要 / Summary", "Summary")),
      element(React, 'textarea', {
        id: 'hti-organizer-summary',
        value: summary,
        maxLength: 2000,
        rows: 5,
        placeholder: sourceText("记录关键结论、已完成事项和下一步。", "Record key conclusions, completed work and next steps."),
        onChange: (event: any) => setSummary(event.target.value),
      }),
      element(React, 'label', { className: 'hti-organizer-pin' },
        element(React, 'input', {
          type: 'checkbox',
          checked: pinned,
          onChange: (event: any) => setPinned(event.target.checked),
        }),
        element(React, 'span', null, sourceText("固定到列表顶部 / Pin to top", "Pin to top"))),
      error ? element(React, 'div', { className: 'hti-organizer-error', role: 'alert' }, error) : null),
    element(React, 'footer', { className: 'hti-organizer-actions' },
      element(React, 'span', null, sourceText("显示名称留空时恢复 Hermes 原始标题；全部留空并取消固定后清除组织信息。", "Leave the display name empty to restore the original Hermes title. Clear all fields and unpin to remove organization metadata.")),
      element(React, 'div', null,
        element(React, 'button', { type: 'button', onClick: onClose, disabled: saving }, sourceText("取消 / Cancel", "Cancel")),
        element(React, 'button', {
          type: 'button', className: 'is-primary', onClick: save, disabled: saving,
        }, saving ? sourceText("保存中…", "Saving…") : sourceText("保存 / Save", "Save"))))));
  };
}
