import {safeAttachments} from './images.mjs';
import {RuntimeError} from './errors.mjs';
// This projection has no persistent conversation store. Every baseline is folded
// from the native session journal; cursor is exclusively a native durable seq.
export function textOf(content) {
  return Array.isArray(content) ? content.filter(x => x?.type === 'text').map(x => x.text ?? '').join('') : '';
}
export function failureOf(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.error || ['error', 'failed'].includes(value.kind) || ['error', 'failed'].includes(value.type)) return true;
  // Only protocol-owned error positions, never words appearing in assistant text.
  return ['reason', 'chunk', 'finish', 'outcome', 'stream'].some(k => {
    const v = value[k]; return Array.isArray(v) ? v.some(failureOf) : failureOf(v);
  });
}
export function failureStatus(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) return value.status;
  for (const key of ['error','reason','chunk','finish','outcome','stream']) {
    const nested = Array.isArray(value[key]) ? value[key] : [value[key]];
    for (const item of nested) { const status = failureStatus(item); if (status) return status; }
  }
}
function inferenceError(value, code = 'dsh/inference-failed') {
  const status = failureStatus(value);
  return {code, message: 'DSH inference failed', ...(status ? {upstream_status: status} : {})};
}
export class Projection {
  constructor(session) {
    this.session = session; this.cursor = -1; this.rows = new Map(); this.status = 'idle';
    this.tools = new Map(); this.generation = 0; this.attempt = undefined; this.failedTurns = new Set(); this.requests = new Set();
  }
  baseline(records, cursor, generation, assistantStream) {
    this.tools.clear(); this.rows.clear(); this.requests.clear(); this.failedTurns.clear(); this.status = 'idle'; this.cursor = -1;
    this.generation = generation; this.attempt = undefined;
    for (const {event} of records) this.durable(event, false);
    this.cursor = cursor;
    const a = assistantStream?.activeAttempt;
    if (a) {
      this.attempt = {id: a.attemptId, next: a.nextIndex, revision: assistantStream.revision,
        content: '', blocks: new Map(), turn: a.turn};
      for (const record of a.stream ?? []) {
        if (record.type === 'text-chunks') this.addText(record.index, record.texts.join(''));
        else if (record.type === 'chunk') this.chunk(record.chunk);
      }
    }
  }
  addText(index, text) {
    if (!this.attempt) return;
    this.attempt.blocks.set(index, (this.attempt.blocks.get(index) ?? '') + text);
    this.attempt.content = [...this.attempt.blocks.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('');
  }
  chunk(chunk) {
    if (chunk?.type === 'text-delta') this.addText(chunk.index, chunk.text);
    if (chunk?.type === 'finish' && failureOf(chunk)) {
      this.status = 'error'; if (this.attempt?.turn !== undefined) this.failedTurns.add(this.attempt.turn);
    }
  }
  durable(event, notify = true) {
    if (!event || event.seq <= this.cursor) return [];
    if (notify && event.seq !== this.cursor + 1)
      throw new RuntimeError(503, 'dsh/journal-gap', 'DSH journal requires a fresh baseline');
    this.cursor = event.seq;
    const settledAttempt = ['assistant/message', 'assistant/attempt'].includes(event.type) ? this.attempt?.id : undefined;
    if (settledAttempt) this.attempt = undefined;
    const data = event.data ?? {}; const output = [];
    let tool;
    if (['tool/call', 'tool/result'].includes(event.type)) {
      tool = {type: event.type, call_id: data.callId ?? data.message?.toolCallId,
        ...(event.type === 'tool/call' ? {name: data.name, arguments: data.arguments, status: 'running'}
          : {content: textOf(data.message?.content), status: data.message?.isError ? 'error' : 'completed'})};
      const previous = this.tools.get(tool.call_id);
      tool = {...previous, ...tool}; this.tools.set(tool.call_id, tool);
    }
    if (event.type === 'turn/start') this.status = 'running';
    if (['assistant/message', 'assistant/attempt'].includes(event.type) && failureOf(data)) {
      this.failedTurns.add(data.turn); this.status = 'error';
      output.push({type: 'error', data: inferenceError(data)});
    }
    if (event.type === 'turn/end') {
      const kind = data.reason?.kind;
      this.status = failureOf(data) || this.failedTurns.has(data.turn) ? 'error'
        : ['cancelled', 'canceled', 'aborted', 'interrupted'].includes(kind) ? 'cancelled'
        : kind === 'completed' ? 'completed' : 'idle';
      if (this.status === 'error') output.push({type: 'error', data: inferenceError(data, 'dsh/turn-failed')});
    }
    const message = data.message ?? (event.type === 'user/message' ? data : undefined);
    if (event.type === 'user/message' && message?.source?.rpcId) this.requests.add(message.source.rpcId);
    if (['user/message', 'assistant/message', 'tool/result'].includes(event.type) && message
      && (event.type !== 'user/message' || !message.source || ['user', 'user-question-reply'].includes(message.source.kind))) {
      const row = {seq: event.seq, message: {id: message.id ?? `${this.session.id}:${event.seq}`,
        role: message.role ?? event.type.split('/')[0], content: textOf(message.content), timestamp: event.time,
        ...(message.source?.rpcId ? {request_id: message.source.rpcId} : {}),
        ...(safeAttachments(message.content).length ? {attachments: safeAttachments(message.content)} : {}),
        ...(tool ? {tool} : {}),
        ...(data.interrupted ? {interrupted: true} : {}),
        ...(failureOf(data) || message.isError ? {status: 'error'} : {})}};
      if (event.surfaceOp?.op === 'replace') {
        for (const [seq] of this.rows) if (seq >= event.surfaceOp.startSeq && seq <= event.surfaceOp.endSeq) this.rows.delete(seq);
        row.seq = event.surfaceOp.startSeq;
      }
      this.rows.set(row.seq, row);
      output.push({type: 'message.committed', data: {...row.message, ...(settledAttempt ? {stream_message_id: settledAttempt} : {})}});
    }
    output.push({type: 'state', data: {status: this.status, event_type: event.type, ...(tool ? {tool} : {})}});
    const durableIndex = Math.max(0, output.findIndex(x => x.type === 'message.committed'));
    return notify ? output.map((x, i) => ({...x, ...(i === durableIndex ? {cursor: event.seq} : {}), native_sequence: event.seq, ...(settledAttempt ? {attempt_id: settledAttempt} : {})})) : [];
  }
  live(frame, generation) {
    if (generation !== this.generation) return [];
    if (frame.type === 'start') {
      if (this.attempt && frame.revision <= this.attempt.revision) return [];
      this.attempt = {id: frame.attemptId, revision: frame.revision, next: 0, content: '', blocks: new Map(), turn: frame.turn};
      return [{type: 'state', attempt_id: frame.attemptId, data: {status: 'running', streaming: true}}];
    }
    const a = this.attempt;
    if (!a || a.id !== frame.attemptId || frame.revision <= a.revision) return [];
    if (frame.type === 'chunk') {
      if (frame.index !== a.next) return []; // Never join a gap or duplicate into visible text.
      a.next++; a.revision = frame.revision; this.chunk(frame.chunk);
      if (frame.chunk?.type === 'finish' && failureOf(frame.chunk))
        return [{type: 'error', attempt_id: a.id, data: inferenceError(frame.chunk)}];
      if (frame.chunk?.type === 'text-delta') return [{type: 'assistant.delta', attempt_id: a.id,
        chunk_index: frame.index, data: {message_id: a.id, delta: frame.chunk.text, content: frame.chunk.text, transient: true}}];
    }
    if (frame.type === 'end') {
      this.attempt = undefined;
      // An end frame is never a success receipt; the native committed event decides.
      return [{type: 'state', attempt_id: a.id, data: {streaming: false, outcome: frame.outcome.kind}}];
    }
    return [];
  }
  snapshot({interactions = [], inbox = [], status} = {}) {
    return {session: this.session, messages: [...this.rows.values()].sort((a, b) => a.seq - b.seq).map(x => x.message),
      cursor: this.cursor, tools: [...this.tools.values()], interactions, inbox, status: status ?? this.status,
      ...(this.attempt ? {streaming: {attempt_id: this.attempt.id, content: this.attempt.content, next_index: this.attempt.next, transient: true}} : {})};
  }
}
