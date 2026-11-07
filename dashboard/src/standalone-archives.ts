import type { FetchJSON } from './workbench-api';
import { currentProfile } from './profile-scope';

type Archive = { id: string; title: string; source: string; message_count?: number; source_hash?: string; read_only: boolean };
type Message = { id: string; role: string; content: string };
export function createArchivePage(sdk: { React: any; hooks: any; fetchJSON: FetchJSON }) {
  const h = sdk.React.createElement, { useState, useEffect, useRef } = sdk.hooks;
  const url = (path: string) => `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(currentProfile())}`;
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return function ArchivesPage() {
    const [rows, setRows] = useState([] as Archive[]), [query, setQuery] = useState(''), [path, setPath] = useState(''), [source, setSource] = useState('hermes');
    const [selected, setSelected] = useState(null as Archive | null), [messages, setMessages] = useState([] as Message[]), [indexes, setIndexes] = useState([] as number[]);
    const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
    const requestId = useRef('');
    useEffect(() => {
      const controller = new AbortController();
      sdk.fetchJSON<{ sessions: Archive[] }>(url('/api/plugins/workbench/archives?q=' + encodeURIComponent(query)), { signal: controller.signal })
        .then(value => setRows(value.sessions)).catch(error => { if (!controller.signal.aborted) setStatus(String(error)); });
      return () => controller.abort();
    }, [query, revision]);
    async function open(row: Archive) {
      setSelected(row); setIndexes([]); requestId.current = ''; setMessages([]); setStatus('');
      try { const value = await sdk.fetchJSON<{ messages: Message[] }>(url(`/api/sessions/${encodeURIComponent(row.id)}/messages?limit=500`)); setMessages(value.messages); }
      catch (error) { setStatus(String(error)); }
    }
    return h('section', { className: 'standalone-domain', 'aria-label': 'Read-only history' }, h('h1', null, 'Read-only history'),
      h('p', null, 'Import an explicitly selected JSON or JSONL transcript from this project. Imported sessions are read-only; selected messages become reference context in a new DSH session.'),
      h('form', { onSubmit: async (event: Event) => { event.preventDefault(); setBusy(true); try {
        const value = await sdk.fetchJSON<{ session: Archive }>(url('/api/plugins/workbench/archives/import'), json({ path, source }));
        setPath(''); setRevision((n: number) => n + 1); await open(value.session); setStatus('Archive imported as read-only history.');
      } catch (error) { setStatus(String(error)); } finally { setBusy(false); } } },
        h('label', null, 'Transcript path', h('input', { required: true, 'aria-label': 'Transcript path', value: path, onChange: (event: any) => setPath(event.target.value) })),
        h('label', null, 'Original source', h('select', { 'aria-label': 'Original source', value: source, onChange: (event: any) => setSource(event.target.value) }, h('option', { value: 'hermes' }, 'Hermes archive'), h('option', { value: 'codex' }, 'Codex archive'))),
        h('button', { type: 'submit', disabled: busy }, 'Import transcript')),
      h('label', null, 'Search archives', h('input', { type: 'search', 'aria-label': 'Search archives', value: query, onChange: (event: any) => setQuery(event.target.value) })),
      h('ul', { className: 'standalone-domain-list' }, rows.map((row: Archive) => h('li', { key: row.id }, h('button', { type: 'button', onClick: () => open(row) }, row.title || row.id), h('span', null, row.source, ' · read-only')))),
      selected ? h('section', { 'aria-label': 'Archived transcript' }, h('h2', null, selected.title || selected.id), h('p', null, 'Original source: ', selected.source, ' · not resumable'),
        h('ol', null, messages.map((message: Message, index: number) => h('li', { key: message.id }, h('label', null, h('input', { type: 'checkbox', 'aria-label': 'Select archived message ' + (index + 1), checked: indexes.includes(index), onChange: (event: any) => { requestId.current = ''; setIndexes(event.target.checked ? [...indexes, index] : indexes.filter((item: number) => item !== index)); } }), message.role), h('pre', { style: { whiteSpace: 'pre-wrap' } }, message.content)))),
        h('button', { type: 'button', disabled: busy || !indexes.length, onClick: async () => { setBusy(true); try {
          if (!requestId.current) requestId.current = crypto.randomUUID();
          const value = await sdk.fetchJSON<{ session: { id: string } }>(url(`/api/plugins/workbench/archives/${encodeURIComponent(selected.id)}/new-session`), json({ indexes, request_id: requestId.current }));
          location.assign('/chat?profile=' + encodeURIComponent(currentProfile()) + '&session=' + encodeURIComponent(value.session.id));
        } catch (error) { setStatus(String(error)); } finally { setBusy(false); } } }, 'Start new DSH session with selection')) : null,
      h('p', { role: 'status' }, status));
  };
}
