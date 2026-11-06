/** Domain views for pages formerly supplied by the plugin host. */
import type { FetchJSON } from './workbench-api';
import { currentProfile } from './profile-scope';
import { listFiles, readFile, writeFile, type FileEntry, type FileDocument } from './workbench-api';
import { createWorkbenchTerminal } from './terminal-runtime';
import { observeTerminalTheme } from './terminal-theme';

type SDK = { React: any; hooks: any; fetchJSON: FetchJSON; buildWsUrl(path: string, params?: Record<string, string>): Promise<string> };
type Selection = { memory: string[]; skills: string[]; mcp: string[] };
type Memory = { files: Record<string, string>; version: number };
type MCPServer = { transport?: string; command?: string; args?: string[]; url?: string; enabled?: boolean; env?: Record<string, string>; headers?: Record<string, string> };
const API = '/api/plugins/workbench';
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const profileURL = (path: string) => `${API}${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(currentProfile())}${new URLSearchParams(location.search).get('project_id') ? '&project_id=' + encodeURIComponent(new URLSearchParams(location.search).get('project_id')!) : ''}`;
const pairs = (value: string) => Object.fromEntries(value.split('\n').filter(row => row.trim()).map(row => {
  const at = row.indexOf('='); if (at < 1) throw new Error('Use NAME=value, one per line');
  return [row.slice(0, at).trim(), row.slice(at + 1)];
}));

export function createStandalonePages(sdk: SDK) {
  const h = sdk.React.createElement, { useState, useEffect, useRef } = sdk.hooks;
  const read = sdk.fetchJSON;
  function MemoryPage() {
    const [memory, setMemory] = useState(null as Memory | null), [selection, setSelection] = useState(null as Selection | null);
    const [file, setFile] = useState('MEMORY.md'), [text, setText] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
    const load = async () => {
      try { const [value, selected] = await Promise.all([read<Memory>(profileURL('/memory')), read<Selection>(profileURL('/runtime-context'))]); setMemory(value); setSelection(selected); setText(value.files[file] || ''); setStatus(''); }
      catch (error) { setStatus(String(error)); }
    };
    useEffect(() => { void load(); }, []);
    const save = async () => {
      if (!memory || busy) return;
      setBusy(true);
      try { const value = await read<Memory>(profileURL('/memory'), json('PUT', { files: { [file]: text }, version: memory.version })); setMemory(value); setStatus('Saved. Selected files apply to new DSH sessions.'); }
      catch (error) { setStatus(String(error)); } finally { setBusy(false); }
    };
    return h('section', { className: 'standalone-domain', 'aria-label': 'Memory' }, h('h1', null, 'Memory'), h('p', null, 'Profile memory and instructions for new DSH sessions.'),
      h('nav', { className: 'standalone-tabs', 'aria-label': 'Memory files' }, ['MEMORY.md', 'USER.md', 'SOUL.md', 'AGENTS.md'].map(name => h('button', { key: name, type: 'button', 'aria-pressed': file === name, onClick: () => { setMemory(memory ? { ...memory, files: { ...memory.files, [file]: text } } : memory); setFile(name); setText(memory?.files[name] || ''); } }, name))),
      h('label', null, file, h('textarea', { 'aria-label': file, rows: 20, value: text, disabled: !memory || busy, onChange: (event: any) => setText(event.target.value) })),
      h('div', { className: 'standalone-actions' }, h('button', { type: 'button', disabled: !memory || busy, onClick: save }, 'Save memory'), h('button', { type: 'button', onClick: load }, 'Reload')),
      selection ? h('fieldset', null, h('legend', null, 'Include in new conversations'), Object.keys(memory?.files || {}).map(name => h('label', { key: name }, h('input', { type: 'checkbox', checked: selection.memory.includes(name), onChange: async (event: any) => {
        const updated = { ...selection, memory: event.target.checked ? [...selection.memory, name] : selection.memory.filter((item: string) => item !== name) };
        setSelection(updated);
        try { setSelection(await read<Selection>(profileURL('/runtime-context'), json('PUT', updated))); setStatus('Memory selection saved.'); } catch (error) { setSelection(selection); setStatus(String(error)); }
      } }), name))) : null, h('p', { role: 'status' }, status));
  }
  function MCPPage() {
    const [servers, setServers] = useState({} as Record<string, MCPServer>), [selection, setSelection] = useState(null as Selection | null);
    const [name, setName] = useState(''), [transport, setTransport] = useState('stdio'), [address, setAddress] = useState(''), [args, setArgs] = useState(''), [credentials, setCredentials] = useState('');
    const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
    const load = async () => { try { const [value, selected] = await Promise.all([read<{ config: { mcpServers: Record<string, MCPServer> } }>(profileURL('/mcp')), read<Selection>(profileURL('/runtime-context'))]); setServers(value.config.mcpServers); setSelection(selected); setStatus(''); } catch (error) { setStatus(String(error)); } };
    useEffect(() => { void load(); }, []);
    const edit = (key: string) => { const server = servers[key]; setName(key); setTransport(server.transport || (server.command ? 'stdio' : 'http')); setAddress(server.command || server.url || ''); setArgs((server.args || []).join('\n')); setCredentials(Object.entries(server.env || server.headers || {}).map(([key, value]) => key + '=' + value).join('\n')); };
    const persist = async (value: Record<string, MCPServer>) => { if (JSON.stringify(value).includes('[REDACTED]')) { setServers(value); setStatus('Changes staged. Re-enter the masked credentials for remaining servers before saving.'); return; } const result = await read<{ config: { mcpServers: Record<string, MCPServer> } }>(profileURL('/mcp'), json('PUT', { mcpServers: value })); setServers(result.config.mcpServers); setStatus('Saved. Select servers to attach to new DSH sessions.'); };
    return h('section', { className: 'standalone-domain', 'aria-label': 'External tools' }, h('h1', null, 'External tools · MCP'), h('p', null, 'Configure tools and select which servers new conversations may use. Credentials remain masked when read.'),
      h('ul', { className: 'standalone-domain-list' }, Object.entries(servers as Record<string, MCPServer>).map(([key, server]) => h('li', { key }, h('strong', null, key), h('span', null, server.command || server.url), h('button', { onClick: () => edit(key) }, 'Edit ' + key),
        h('label', null, h('input', { type: 'checkbox', checked: selection?.mcp.includes(key) || false, disabled: !selection, onChange: async (event: any) => {
          const updated = { ...selection, mcp: event.target.checked ? [...selection!.mcp, key] : selection!.mcp.filter((item: string) => item !== key) };
          setSelection(updated);
        try { setSelection(await read<Selection>(profileURL('/runtime-context'), json('PUT', updated))); setStatus('Tool selection saved.'); } catch (error) { setSelection(selection); setStatus(String(error)); }
        } }), 'Use in new sessions'), h('button', { onClick: async () => { try { const next = { ...servers }; delete next[key]; await persist(next); } catch (error) { setStatus(String(error)); } } }, 'Remove ' + key)))),
      h('form', { onSubmit: async (event: Event) => { event.preventDefault(); setBusy(true); try {
        const server: MCPServer = transport === 'stdio' ? { transport, command: address, args: args.split('\n').filter(Boolean), env: pairs(credentials) } : { transport, url: address, headers: pairs(credentials) };
        await persist({ ...servers, [name]: server }); setName(''); setAddress(''); setArgs(''); setCredentials('');
      } catch (error) { setStatus(String(error)); } finally { setBusy(false); } } },
      h('h2', null, 'Add or update a server'), field('Server name', name, setName), h('label', null, 'Transport', h('select', { value: transport, onChange: (event: any) => setTransport(event.target.value) }, ['stdio', 'http', 'sse'].map(value => h('option', { key: value }, value)))),
      field(transport === 'stdio' ? 'Command' : 'Server URL', address, setAddress), transport === 'stdio' ? area('Arguments, one per line', args, setArgs, 3) : null,
      area(transport === 'stdio' ? 'Environment, NAME=value' : 'Headers, NAME=value', credentials, setCredentials, 3),
      h('p', null, 'To change an existing credential, replace every [REDACTED] value before saving.'), h('button', { type: 'submit', disabled: busy || !name || !address || credentials.includes('[REDACTED]') }, 'Save server')),
      h('button', { type: 'button', onClick: async () => { try { await persist(servers); } catch (error) { setStatus(String(error)); } } }, 'Save all servers'), h('button', { type: 'button', onClick: load }, 'Reload tools'), h('p', { role: 'status' }, status));
  }
  function field(label: string, value: string, update: (value: string) => void) { return h('label', null, label, h('input', { required: true, value, 'aria-label': label, onChange: (event: any) => update(event.target.value) })); }
  function area(label: string, value: string, update: (value: string) => void, rows = 12) { return h('label', null, label, h('textarea', { value, rows, 'aria-label': label, onChange: (event: any) => update(event.target.value) })); }
  function Configuration() {
    const [config, setConfig] = useState({} as Record<string, any>), [models, setModels] = useState([] as { id: string; label?: string }[]), [description, setDescription] = useState(''), [status, setStatus] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => { void Promise.all([read<Record<string, any>>('/api/config?profile=' + encodeURIComponent(currentProfile())), read<{ models: { id: string; label?: string }[] }>('/api/runtime/models')]).then(([value, catalog]) => { setConfig(value); setDescription(value.description || ''); setModels(catalog.models || []); }).catch(error => setStatus(String(error))).finally(() => setLoading(false)); }, []);
    return h('form', { className: 'standalone-domain', onSubmit: async (event: Event) => { event.preventDefault(); try {
      await read('/api/config?profile=' + encodeURIComponent(currentProfile()), json('PUT', config));
      await read('/api/profiles/' + encodeURIComponent(currentProfile()) + '/description', json('PUT', { description })); setStatus('Saved. Applies to new DSH sessions.');
    } catch (error) { setStatus(String(error)); } } }, h('h1', null, 'Profile configuration'), h('p', null, 'Defaults and instructions applied when DSH creates a conversation.'),
      h('fieldset', { disabled: loading }, h('label', null, 'Default model', h('select', { 'aria-label': 'Default model', value: typeof config.model === 'string' ? config.model : '', onChange: (event: any) => setConfig({ ...config, model: event.target.value }) }, h('option', { value: '' }, 'Runtime default'), models.map((model: { id: string; label?: string }) => h('option', { key: model.id, value: model.id }, model.label || model.id)))),
      area('Profile description', description, setDescription), h('a', { href: '/memory?profile=' + encodeURIComponent(currentProfile()) }, 'Edit memory and SOUL.md'), h('button', { type: 'submit' }, 'Save defaults')), h('p', { role: 'status' }, loading ? 'Loading profile defaults…' : status));
  }
  function ModelsPage() {
    const [models, setModels] = useState([] as { id: string; name?: string; provider?: string }[]), [configured, setConfigured] = useState(''), [status, setStatus] = useState('');
    const config = useRef({} as Record<string, unknown>);
    useEffect(() => { void Promise.all([read<{ models: { id: string; name?: string; provider?: string }[]; default?: { model?: string; provider?: string } }>('/api/runtime/models'), read<Record<string, unknown>>('/api/config?profile=' + encodeURIComponent(currentProfile()))]).then(([catalog, saved]) => {
      config.current = saved; setConfigured(typeof saved.model === 'string' ? saved.model : catalog.default?.model || '');
      setModels(catalog.models.filter(model => !catalog.default?.provider || model.provider === catalog.default.provider));
    }).catch(error => setStatus(String(error))); }, []);
    return h('section', { className: 'standalone-domain' }, h('h1', null, 'Models'), h('p', null, 'Available models from the connected DSH provider. The profile default applies to new sessions.'),
      h('ul', { className: 'standalone-domain-list' }, models.map((model: { id: string; name?: string; provider?: string }) => h('li', { key: model.id }, h('strong', null, model.name || model.id), h('span', null, model.provider), h('button', { type: 'button', disabled: configured === model.id, onClick: async () => {
        try { const updated = { ...config.current, model: model.id }; await read('/api/config?profile=' + encodeURIComponent(currentProfile()), json('PUT', updated)); config.current = updated; setConfigured(model.id); setStatus('Default model saved.'); } catch (error) { setStatus(String(error)); }
      } }, configured === model.id ? 'Profile default' : 'Use as default')))), h('p', { role: 'status' }, status));
  }
  function FilesPage() {
    const [path, setPath] = useState(''), [rows, setRows] = useState([] as FileEntry[]), [document, setDocument] = useState(null as FileDocument | null), [content, setContent] = useState(''), [status, setStatus] = useState(''), [newPath, setNewPath] = useState('');
    const scopedRead: FetchJSON = (url, init) => read(profileURL(url.slice(API.length)), init);
    const load = async (directory = path) => { try { setRows(await listFiles(scopedRead, directory)); setPath(directory); setStatus(''); } catch (error) { setStatus(String(error)); } };
    useEffect(() => { void load(); }, []);
    return h('section', { className: 'standalone-domain standalone-files', 'aria-label': 'Files' }, h('h1', null, 'Files'), h('p', null, 'Files in the selected project workspace.'), h('button', { onClick: () => load(path.split('/').slice(0, -1).join('/')) }, 'Parent directory'), h('span', null, path || '/'),
      h('div', { className: 'standalone-file-columns' }, h('ul', { className: 'standalone-domain-list' }, rows.map((entry: FileEntry) => h('li', { key: entry.path }, h('button', { onClick: async () => { if (entry.type === 'directory') { await load(entry.path); return; } try { const value = await readFile(scopedRead, entry.path); setDocument(value); setContent(value.content); setStatus(''); } catch (error) { setStatus(String(error)); } } }, entry.type === 'directory' ? '▰ ' + entry.name : entry.name)))),
        document ? h('div', null, area(document.path, content, setContent, 20), h('button', { onClick: async () => { try { const result = await writeFile(scopedRead, document.path, content, document.version); setDocument({ ...document, version: result.version }); setStatus('File saved.'); } catch (error) { setStatus(String(error)); } } }, 'Save file')) : h('p', null, 'Select a file to edit.')),
      h('form', { onSubmit: async (event: Event) => { event.preventDefault(); try { await read(profileURL('/file?path=' + encodeURIComponent(newPath)), json('PUT', { content: '', mode: 'create' })); setNewPath(''); await load(); setStatus('File created.'); } catch (error) { setStatus(String(error)); } } }, field('New file path', newPath, setNewPath), h('button', { type: 'submit' }, 'Create file')), h('p', { role: 'status' }, status));
  }
  function ShellPage() {
    const node = useRef(null), [status, setStatus] = useState('Connecting to project shell…');
    useEffect(() => {
      if (!node.current) return;
      const { terminal, fit } = createWorkbenchTerminal(node.current);
      const theme = observeTerminalTheme(node.current, terminal);
      let socket: WebSocket | undefined, disposed = false;
      const resize = () => { try { fit.fit(); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows })); } catch { /* Hidden pane. */ } };
      const observer = new ResizeObserver(resize); observer.observe(node.current);
      const input = terminal.onData(data => { if (socket?.readyState === WebSocket.OPEN) socket.send(data); });
      void sdk.buildWsUrl(API + '/shell', { profile: currentProfile() }).then(url => {
        if (disposed) return; socket = new WebSocket(url);
        socket.onopen = () => { setStatus('Connected to project shell'); resize(); terminal.focus(); };
        socket.onmessage = event => terminal.write(String(event.data));
        socket.onerror = () => setStatus('Project shell unavailable');
        socket.onclose = event => { if (!disposed) setStatus(event.code === 4503 ? 'Project shell unavailable: filesystem sandbox could not start' : 'Project shell disconnected'); };
      }).catch(error => setStatus(String(error)));
      return () => { disposed = true; socket?.close(); observer.disconnect(); input.dispose(); theme(); terminal.dispose(); };
    }, []);
    return h('section', { className: 'standalone-domain standalone-shell-page' }, h('h1', null, 'Project terminal'), h('p', { role: 'status' }, status), h('div', { ref: node, className: 'standalone-terminal' }));
  }
  function IntegrationsPage() {
    const [skillName, setSkillName] = useState(''), [skillContent, setSkillContent] = useState('');
    const [selection, setSelection] = useState(null as Selection | null), [skills, setSkills] = useState([] as { name: string }[]), [status, setStatus] = useState('');
    useEffect(() => { void Promise.all([read<Selection>(profileURL('/runtime-context')), read<{ skills: { name: string }[] }>(profileURL('/skills/files'))]).then(([value, catalog]) => { setSelection(value); setSkills(catalog.skills); }).catch(error => setStatus(String(error))); }, []);
    return h('section', { className: 'standalone-domain' }, h('h1', null, 'Integrations'), h('p', null, 'Profile skills and external tools used by new DSH sessions.'),
      h('a', { href: '/skills?profile=' + encodeURIComponent(currentProfile()) }, 'Manage skill files'), ' · ', h('a', { href: '/mcp?profile=' + encodeURIComponent(currentProfile()) }, 'Configure MCP tools'),
      h('form', { onSubmit: async (event: Event) => { event.preventDefault(); try { await read(profileURL('/skills/files/skill'), json('POST', { name: skillName, content: skillContent, mode: 'create' })); setSkills([...skills, { name: skillName }]); setSkillName(''); setSkillContent(''); setStatus('Skill created. Select it below to use in new conversations.'); } catch (error) { setStatus(String(error)); } } }, h('h2', null, 'Create a skill'), field('Skill name', skillName, setSkillName), area('SKILL.md content', skillContent, setSkillContent, 6), h('button', { type: 'submit' }, 'Create skill')),
      h('fieldset', null, h('legend', null, 'Active skills'), skills.map((skill: { name: string }) => h('label', { key: skill.name }, h('input', { type: 'checkbox', disabled: !selection, checked: selection?.skills.includes(skill.name) || false, onChange: async (event: any) => {
        const updated = { ...selection, skills: event.target.checked ? [...selection!.skills, skill.name] : selection!.skills.filter((name: string) => name !== skill.name) };
        setSelection(updated);
        try { setSelection(await read<Selection>(profileURL('/runtime-context'), json('PUT', updated))); setStatus('Skill selection saved.'); } catch (error) { setSelection(selection); setStatus(String(error)); }
      } }), skill.name))), h('p', { role: 'status' }, status));
  }
  return { MemoryPage, MCPPage, Configuration, ModelsPage, FilesPage, ShellPage, IntegrationsPage };
}
