/** Neutral HTTP/SSE transport. Receipts never become assistant completions. */
import type { FetchJSON } from './workbench-api';
import type { ChatMessage } from './codex-messages';
import { normalizeSession } from './codex-api';
import { record, text } from './api-values';

export type RuntimeEvent = { type: string; session_id: string; cursor?: string | number; sequence?: number; attempt_id?: string; data: Record<string, unknown> };
export type RuntimeSnapshot = { session: Record<string, unknown>; messages: { id: string; role: string; content: string; timestamp?: number; request_id?: string; status?: string; attachments?: Record<string, unknown>[]; tool?: Record<string, unknown> }[]; cursor: string | number; interactions: Record<string, unknown>[]; inbox: Record<string, unknown>[]; status: string; deliveries?: Record<string, unknown>[]; error?: string; tools?: Record<string, unknown>[]; streaming?: { attempt_id: string; content: string; message_id?: string } };
export type Presentation = ReturnType<typeof projectSnapshot>;
export const sessionURL = (profile: string, session: string) => `/api/runtime/sessions/${encodeURIComponent(session)}`;
export const scoped = (url: string, profile: string) => `${url}${url.includes('?') ? '&' : '?'}profile_id=${encodeURIComponent(profile)}`;

export function projectInteraction(value: Record<string, unknown>) {
  return { ...value, id: text(value.id ?? value.request_id), kind: value.kind || 'approval',
    questions: value.questions, text: [text(value.prompt ?? value.reason, 'DSH interaction requires a response'), text(value.command)].filter(Boolean).join('\n') };
}
export function projectFleetNotification(value: Record<string, unknown>): ChatMessage {
  const id = text(value.delivery_id ?? value.id);
  if (value.source !== 'fleet' || !id || !value.task_id || !value.attempt_id || !Number.isInteger(value.epoch) || typeof value.content !== 'string') throw new Error('Invalid persisted Fleet notification');
  return { id: 'fleet-notification:' + id, role: 'notification', content: value.content,
    delivery: { source: 'fleet', id, task_id: value.task_id, attempt_id: value.attempt_id, epoch: value.epoch, kind: value.kind },
    observedAt: typeof value.timestamp === 'number' ? value.timestamp : undefined };
}
export function projectSnapshot(snapshot: RuntimeSnapshot) {
  if (!snapshot.session?.id || !Array.isArray(snapshot.messages)) throw new Error('Incomplete DSH session snapshot');
  const running = ['running', 'waiting', 'accepted', 'processing'].includes(snapshot.status);
  const persisted = snapshot.messages.map(message => ({ ...message,
    ...(message.tool?.call_id ? { id: 'tool:' + text(message.tool.call_id), role: 'tool', toolName: text(message.tool.name, 'Tool'), input: message.tool.arguments, result: message.tool.content ?? message.content, turnId: text(message.tool.attempt_id, String(snapshot.session.id)) } : {}),
    status: ['failed', 'error'].includes(message.status || '') ? 'failed' : 'completed',
    clientRequestId: message.request_id, observedAt: message.timestamp,
    attachments: message.attachments?.map(attachment => {
      const id = text(attachment.attachmentId ?? attachment.id);
      const profile = text(snapshot.session.profile_id), session = text(snapshot.session.id);
      return { id, name: text(attachment.name, 'Attachment'), kind: text(attachment.kind) || undefined, size: typeof attachment.size === 'number' ? attachment.size : undefined, fileCount: typeof attachment.fileCount === 'number' ? attachment.fileCount : undefined,
        src: id && text(attachment.mediaType ?? attachment.media_type).startsWith('image/')
          ? `/api/plugins/workbench/attachments/${encodeURIComponent(id)}/preview?profile=${encodeURIComponent(profile)}&session_id=${encodeURIComponent(session)}` : undefined };
    }),
  } as ChatMessage));
  const inbox: ChatMessage[] = (snapshot.inbox || []).flatMap(request => {
    const id = text(request.request_id ?? request.id);
    if (!id || typeof request.content !== 'string' || persisted.some(message => message.id === id || message.clientRequestId === id)) return [];
    return [{ id, clientRequestId: id, role: 'user', content: request.content, status: request.status === 'failed' ? 'failed' : 'accepted', submissionError: request.error }];
  });
  const tools: ChatMessage[] = (snapshot.tools || []).filter(tool => !persisted.some(message => message.id === 'tool:' + text(tool.call_id))).map(tool => ({ id: 'tool:' + text(tool.call_id), role: 'tool', toolName: text(tool.name, 'Tool'), content: typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content ?? ''), input: tool.arguments, result: tool.content, status: tool.type === 'tool/call' ? 'running' : ['failed', 'error'].includes(text(tool.status)) ? 'failed' : 'completed', turnId: text(tool.attempt_id, String(snapshot.session.id)) }));
  const streaming: ChatMessage[] = snapshot.streaming?.content ? [{ id: snapshot.streaming.message_id || snapshot.streaming.attempt_id, turnId: snapshot.streaming.attempt_id, role: 'assistant', content: snapshot.streaming.content, status: 'running' }] : [];
  return {
    messages: [...persisted, ...inbox, ...tools, ...streaming, ...(snapshot.deliveries || []).map(projectFleetNotification)],
    session: normalizeSession({ ...snapshot.session, status: snapshot.status }),
    runtimeError: snapshot.error || (['failed', 'error'].includes(snapshot.status) ? 'DSH session failed. Check runtime diagnostics.' : ''),
    next: 0, cursor: snapshot.cursor, readSeq: 0, lastCompletedSeq: 0,
    // Existing UI calls its active-operation marker turnId. It stays presentation-only.
    turnId: running ? String(snapshot.session.id) : '',
    pendingApprovals: (snapshot.interactions || []).map(projectInteraction),
  };
}
export async function readRuntimeSnapshot(read: FetchJSON, profile: string, session: string) {
  return projectSnapshot(await read<RuntimeSnapshot>(scoped(sessionURL(profile, session) + '/snapshot', profile)));
}

/** Reducer fences replayed events and retired attempts. Snapshot is authoritative. */
export class RuntimeProjection {
  value: Presentation | null = null;
  profile = '';
  sequence = -1;
  attempt = '';
  retired = new Set<string>();
  seen = new Set<string>();
  constructor(readonly session: string) {}
  apply(event: RuntimeEvent): Presentation | null {
    if (event.session_id !== this.session) return this.value;
    if (event.type === 'snapshot') {
      const snapshot = event.data as unknown as RuntimeSnapshot;
      this.profile = text(snapshot.session.profile_id);
      this.value = projectSnapshot(snapshot);
      this.sequence = event.sequence ?? -1;
      this.attempt = event.attempt_id || snapshot.streaming?.attempt_id || '';
      this.seen.clear();
      return this.value;
    }
    if (!this.value) return null;
    const eventKey = event.cursor === undefined ? '' : `${event.cursor}:${event.type}:${text(event.data.id ?? record(event.data.message).id ?? record(event.data.tool).call_id)}`;
    if (eventKey && this.seen.has(eventKey)) return this.value;
    if (event.sequence !== undefined && event.sequence <= this.sequence) return this.value;
    if (event.type === 'delivery.received') {
      const message = projectFleetNotification(record(event.data.delivery));
      this.value = { ...this.value, messages: [...this.value.messages.filter(row => row.id !== message.id), message] };
      if (event.sequence !== undefined) this.sequence = event.sequence;
      if (eventKey) this.seen.add(eventKey);
      if (event.cursor !== undefined) this.value.cursor = event.cursor;
      return this.value;
    }
    if (event.attempt_id && this.retired.has(event.attempt_id)) return this.value;
    if (event.attempt_id && this.attempt && event.attempt_id !== this.attempt) {
      if (event.type !== 'state' || !['running', 'accepted'].includes(text(event.data.status))) return this.value;
      this.retired.add(this.attempt);
    }
    if (event.attempt_id) this.attempt = event.attempt_id;
    if (event.sequence !== undefined) this.sequence = event.sequence;
    if (eventKey) this.seen.add(eventKey);
    if (event.cursor !== undefined) this.value.cursor = event.cursor;
    const data = event.data;
    if (event.type === 'assistant.delta') {
      const id = text(data.message_id ?? data.id);
      if (!id) throw new Error('DSH delta missing message id');
      const messages = [...this.value.messages];
      const index = messages.findIndex(m => m.id === id);
      const previous = messages[index];
      // A persisted commit wins over delayed deltas for that message.
      if (previous?.status === 'completed') return this.value;
      const message: ChatMessage = { ...previous, id, turnId: event.attempt_id || this.attempt || this.session, role: 'assistant', content: (previous?.content || '') + text(data.delta ?? data.content), status: 'running' };
      if (index < 0) messages.push(message); else messages[index] = message;
      this.value = { ...this.value, messages, turnId: this.session };
    } else if (event.type === 'message.committed') {
      const raw = record(data.message ?? data);
      if (!raw.id || typeof raw.content !== 'string') throw new Error('Invalid committed DSH message');
      const message = projectSnapshot({ session: { id: this.session, profile_id: this.profile }, messages: [raw as RuntimeSnapshot['messages'][number]], cursor: this.value.cursor, interactions: [], inbox: [], status: 'running' }).messages[0];
      const matches = (m: ChatMessage) => m.id === message.id || message.role === 'assistant' && m.role === 'assistant' && m.status === 'running' && (!event.attempt_id || m.turnId === event.attempt_id) || !!message.clientRequestId && (m.id === message.clientRequestId || m.clientRequestId === message.clientRequestId);
      const index = this.value.messages.findIndex(matches);
      const messages = this.value.messages.filter(m => !matches(m));
      messages.splice(index < 0 ? messages.length : index, 0, message);
      this.value = { ...this.value, messages };
    } else if (event.type === 'interaction.requested') {
      const interaction = projectInteraction(record(data.interaction ?? data));
      this.value = { ...this.value, turnId: this.session, pendingApprovals: [...this.value.pendingApprovals.filter(i => i.id !== interaction.id), interaction] };
    } else if (event.type === 'interaction.resolved') {
      this.value = { ...this.value, pendingApprovals: this.value.pendingApprovals.filter(i => i.id !== String(data.request_id ?? data.id)) };
    } else if (event.type === 'state') {
      const status = text(data.status);
      const active = status ? ['running', 'waiting', 'accepted', 'processing'].includes(status) : !!this.value.turnId;
      const tool = record(data.tool);
      if (tool.type === 'tool/call' || tool.type === 'tool/result') {
        const id = 'tool:' + text(tool.call_id);
        if (!tool.call_id) throw new Error('DSH tool event missing call id');
        const index = this.value.messages.findIndex(message => message.id === id);
        const previous = this.value.messages[index];
        if (!(tool.type === 'tool/call' && previous?.status === 'completed')) {
          const message: ChatMessage = { ...previous, id, role: 'tool', turnId: event.attempt_id || this.attempt || this.session, toolName: text(tool.name, previous?.toolName || 'Tool'), content: typeof tool.content === 'string' ? tool.content : tool.content == null ? '' : JSON.stringify(tool.content), input: tool.arguments ?? previous?.input, result: tool.type === 'tool/result' ? tool.content : previous?.result, status: ['failed', 'error'].includes(text(tool.status)) ? 'failed' : tool.type === 'tool/result' ? 'completed' : 'running' };
          const messages = [...this.value.messages];
          if (index < 0) messages.push(message); else messages[index] = message;
          this.value = { ...this.value, messages };
        }
      }
      this.value = { ...this.value, runtimeError: ['running', 'accepted'].includes(status) ? '' : this.value.runtimeError, turnId: active ? this.session : '', session: this.value.session ? { ...this.value.session, status: !status ? this.value.session.status : active ? status === 'waiting' ? 'waiting' : 'running' : ['failed', 'error'].includes(status) ? 'failed' : status === 'cancelled' ? 'idle' : 'completed' } : null };
      if (!active) {
        this.value.pendingApprovals = [];
        if (['cancelled', 'failed', 'error'].includes(status)) this.value.messages = this.value.messages.map(message => message.status === 'running' ? { ...message, status: 'failed' } : message);
      }
    } else if (event.type === 'error') {
      this.value = { ...this.value, runtimeError: text(data.message ?? data.error, 'DSH runtime error'), turnId: '', session: this.value.session ? { ...this.value.session, status: 'failed' } : null };
    }
    return this.value;
  }
}

type StreamCallbacks = { update(value: Presentation): void; error(error: Error): void; open(): void };
export function subscribeRuntime(read: FetchJSON, profile: string, session: string, callbacks: StreamCallbacks,
  streamFetch: typeof fetch = fetch) {
  let disposed = false, generation = 0, failures = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const projection = new RuntimeProjection(session);
  const connect = async () => {
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const active = () => !disposed && generation === current;
    try {
      // Reconcile durable settlement on every reconnect, including missed commits.
      const snapshot = await read<RuntimeSnapshot>(scoped(sessionURL(profile, session) + '/snapshot', profile), { signal });
      if (!active()) return;
      projection.apply({ type: 'snapshot', session_id: session, data: snapshot as unknown as Record<string, unknown> });
      callbacks.update(projection.value!);
      const response = await streamFetch(scoped(sessionURL(profile, session) + '/events', profile) + '&cursor=' + encodeURIComponent(String(snapshot.cursor ?? '')), { signal, credentials: 'same-origin', headers: { 'X-Workbench-Request': '1' } });
      if (!response.ok || !response.body) throw new Error(`DSH event stream rejected (HTTP ${response.status})`);
      if (!active()) return;
      callbacks.open(); failures = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (active()) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data || !active()) continue;
            const event = JSON.parse(data) as RuntimeEvent;
            const view = projection.apply(event);
            if (view && active()) { callbacks.update(view); if (event.type === 'error') callbacks.error(new Error(view.runtimeError)); }
            if (event.type === 'message.committed' && record(event.data.message ?? event.data).role === 'user') {
              void read<RuntimeSnapshot>(scoped(sessionURL(profile, session) + '/snapshot', profile), { signal }).then(snapshot => {
                if (!active() || !projection.value) return;
                const restored = projectSnapshot(snapshot).messages;
                projection.value = { ...projection.value, messages: projection.value.messages.map(message => {
                  const incoming = restored.find(candidate => candidate.id === message.id);
                  return incoming?.attachments?.length ? { ...message, attachments: incoming.attachments } : message;
                }) };
                callbacks.update(projection.value);
              }).catch(() => { /* The normal reconnect path will restore durable attachment cards. */ });
            }

          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (active()) throw new Error('DSH event stream disconnected; reconnecting');
    } catch (error) {
      if (active() && !signal.aborted) callbacks.error(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (active()) timer = setTimeout(() => { void connect(); }, Math.min(5000, 250 * 2 ** Math.min(failures++, 5)));
    }
  };
  const resume = () => { if (!document.hidden && !disposed) { clearTimeout(timer); void connect(); } };
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  void connect();
  return () => { disposed = true; generation++; clearTimeout(timer); controller?.abort(); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
}
