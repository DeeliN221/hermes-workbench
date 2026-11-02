import type { MessageAttachmentPreview } from './codex-messages';
import { uiText } from './ui-locale';

interface ReactRuntime {
  createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): any;
  useState<T>(initial: T): [T, (value: T) => void];
  useEffect(effect: () => void | (() => void), dependencies: unknown[]): void;
}

/** Fetch persisted images through host authentication, including token-only hosts. */
export function MessageAttachment({ React, attachment }: { React: ReactRuntime; attachment: MessageAttachmentPreview }) {
  const source = attachment.src || '';
  const remote = source.startsWith('/api/plugins/workbench/codex/attachments/');
  const [loaded, setLoaded] = React.useState({ source: '', url: '' });
  const [failed, setFailed] = React.useState('');
  React.useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    let objectUrl = '';
    const sdk = (window as any).__HERMES_PLUGIN_SDK__;
    const read = sdk?.authedFetch
      ? sdk.authedFetch(source, { signal: controller.signal })
      : fetch(source, { credentials: 'same-origin', signal: controller.signal });
    void Promise.resolve(read).then(async (response: Response) => {
      if (!response.ok) throw new Error('Image unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ source, url: objectUrl });
    }).catch(() => { if (!controller.signal.aborted) setFailed(source); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, remote]);
  const src = failed === source ? '' : remote ? loaded.source === source ? loaded.url : '' : source;
  if (src) return React.createElement('img', {
    className: 'codex-message-attachment', src, alt: attachment.name, loading: 'lazy',
    onError: () => setFailed(source),
  });
  return React.createElement('div', { className: 'codex-message-file' },
    React.createElement('span', { 'aria-hidden': true }, attachment.kind === 'folder' ? '▰' : '▤'),
    React.createElement('span', null, attachment.name),
    attachment.kind === 'folder' && attachment.fileCount != null
      ? React.createElement('small', null, uiText(`${attachment.fileCount} 个文件`, `${attachment.fileCount} ${attachment.fileCount === 1 ? 'file' : 'files'}`)) : null);
}
