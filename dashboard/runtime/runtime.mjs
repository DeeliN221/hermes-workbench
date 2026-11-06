import {EventEmitter} from 'node:events';
import {randomUUID, createHash} from 'node:crypto';
import {isAbsolute, resolve} from 'node:path';
import {stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {imageParts} from './images.mjs';
import {normalizeContext, contextIdentity} from './context.mjs';
import {Projection} from './projection.mjs';
import {RuntimeError, nonempty, publicError} from './errors.mjs';

export function sessionRef(meta) {
  return {id: meta.id, runtime: 'dsh', profile_id: meta.profile_id, project_id: meta.project_id, ...(meta.user_id ? {user_id: meta.user_id} : {})};
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Runtime extends EventEmitter {
  constructor({peer, store, provider, model}) {
    super(); this.peer = peer; this.store = store; this.provider = provider; this.model = model;
    this.epoch = randomUUID(); this.monitors = new Map(); this.interactions = new Map(); this.operations = new Map(); this.closed = false;
    this.remoteListener = (frame, generation) => this.remoteEvent(frame, generation);
    this.disconnectListener = generation => {
      for (const m of this.monitors.values()) {
        m.control?.abort(); m.active = false;
        this.publish(m.id, {type: 'state', data: {status: 'disconnected'}, generation});
      }
      for (const [id, pending] of this.interactions) if (pending.generation === generation) {
        this.interactions.delete(id);
        this.publish(pending.session_id, {type: 'interaction.resolved', data: {request_id: id, status: 'expired'}, generation});
      }
    };
    peer.on('remote-event', this.remoteListener); peer.on('disconnected', this.disconnectListener);
  }
  async init() {
    await this.peer.connect(); await this.peer.ensureContextService?.();
    // Restore only bridge-owned sessions. DSH may contain sessions owned by other callers.
    for (const meta of this.store.sessions.values()) this.startMonitor(meta);
    // In-flight intent replays use DSH's native durable/queued requestId deduplication.
    this.recovery = Promise.allSettled([...this.store.sessions.values()].flatMap(meta =>
      Object.entries(meta.requests ?? {}).filter(([, r]) => r.input).map(([id, r]) => this.submit(meta, id, r.input))));
  }
  async models() {
    const catalog = await this.peer.call('modelCatalog');
    const models = catalog.groups.flatMap(g => g.models.map(m => ({id: m.id, provider: g.id, name: m.name})));
    return {models, default: {provider: this.provider, model: this.model}};
  }
  capabilities() {
    return {runtime: 'dsh', status: this.peer.connected ? 'ready' : 'unavailable', capabilities: {
      sessions: true, streaming: true, durable_history: true, reconnect: true,
      queue: true, steer: true, cancel: true, request_idempotency: true,
      tools: {execution: true, results: true},
      interactions: {approvals: true, questions: true, timed_questions: false},
      attachments: {images: true, files: false}, context: {memory: true, skills: true, mcp_stdio: true, mcp_http: true},
    }};
  }
  get(id, scope = {}) {
    const meta = this.store.sessions.get(id);
    if (!meta || (scope.profile_id && scope.profile_id !== meta.profile_id)
      || (scope.project_id && scope.project_id !== meta.project_id) || (scope.user_id && scope.user_id !== meta.user_id))
      throw new RuntimeError(404, 'runtime/session-not-found', 'Session not found in scope');
    return meta;
  }
  list(scope = {}) {
    return {sessions: [...this.store.sessions.values()]
      .filter(m => (!scope.profile_id || scope.profile_id === m.profile_id) && (!scope.project_id || scope.project_id === m.project_id) && (!scope.user_id || scope.user_id === m.user_id))
      .map(m => ({...sessionRef(m), cwd: m.cwd, ...(m.title ? {title: m.title} : {})}))};
  }
  async create(input) {
    nonempty(input.profile_id, 'profile_id', 200); nonempty(input.project_id, 'project_id', 200);
    nonempty(input.cwd, 'cwd');
    if (!isAbsolute(input.cwd) || !(await stat(input.cwd).catch(() => null))?.isDirectory())
      throw new RuntimeError(400, 'runtime/invalid-cwd', 'cwd must be an existing absolute directory');
    const catalog = await this.models();
    const wanted = input.model ?? this.model;
    const chosen = catalog.models.find(m => m.id === wanted && m.provider === this.provider);
    if (!chosen) throw new RuntimeError(400, 'runtime/model-unavailable', 'Model is unavailable on the configured provider');
    const context = normalizeContext(input.runtime_context, input.cwd);
    const agentPreset = input.agent_preset ?? 'standard';
    if (!['standard','minimal'].includes(agentPreset)) throw new RuntimeError(422, 'runtime/invalid-preset', 'Unsupported base preset');
    const presetId = context ? contextIdentity({...input, runtime_context: context, agent_preset: agentPreset}) : agentPreset;
    if (input.title !== undefined) nonempty(input.title, 'title', 200);
    // Publish ownership before invoking DSH. A crash cannot orphan an owned native log.
    const id = `session-${randomUUID()}`;
    const meta = {id, profile_id: input.profile_id, project_id: input.project_id, cwd: resolve(input.cwd),
      model: chosen.id, provider: chosen.provider, title: input.title, requests: {}, provisioned: false, user_id: input.user_id, agent_preset: agentPreset, preset_id: presetId, runtime_context: context};
    this.store.sessions.set(id, meta); await this.store.save();
    await this.provision(meta);
    return sessionRef(meta);
  }
  async provision(meta) {
    if (meta.runtime_context && meta.contextGeneration !== `${this.epoch}:${this.peer.generation}`) {
      await this.peer.registerContext({preset_id: meta.preset_id, user_id: meta.user_id, profile_id: meta.profile_id,
        project_id: meta.project_id, agent_preset: meta.agent_preset, runtime_context: meta.runtime_context});
      meta.contextGeneration = `${this.epoch}:${this.peer.generation}`;
    }
    if (meta.provisioned) return;
    const created = await this.peer.call('create', {sessionId: meta.id, cwd: meta.cwd, agentPreset: meta.preset_id ?? meta.agent_preset ?? 'standard'});
    if (created.sessionId !== meta.id) throw new RuntimeError(502, 'dsh/identity-mismatch', 'DSH changed Session identity');
    await this.peer.call('selectModel', {sessionId: meta.id, provider: meta.provider, model: meta.model});
    if (meta.title) await this.peer.call('rename', {sessionId: meta.id, title: meta.title});
    meta.provisioned = true; await this.store.save();
  }
  startMonitor(meta) {
    if (this.monitors.has(meta.id)) return this.monitors.get(meta.id);
    const monitor = {id: meta.id, projection: new Projection(sessionRef(meta)), active: false, waiters: new Set()};
    this.monitors.set(meta.id, monitor); monitor.task = this.monitor(meta, monitor);
    return monitor;
  }
  async ensure(meta) {
    const m = this.startMonitor(meta);
    if (m.active && this.peer.connected && m.projection.generation === this.peer.generation) return m;
    if (m.terminalError) throw m.terminalError;
    return new Promise((resolve, reject) => {
      const waiter = {resolve, reject}; m.waiters.add(waiter);
      waiter.timer = setTimeout(() => { m.waiters.delete(waiter); reject(new RuntimeError(503, 'runtime/not-ready', 'Session is reconnecting')); }, 15000);
    });
  }
  settle(m, error) {
    for (const w of m.waiters) { clearTimeout(w.timer); error ? w.reject(error) : w.resolve(m); }
    m.waiters.clear();
  }
  async fullRecords(id, opening) {
    let records = [...opening.records]; let hasMore = opening.hasMore;
    while (hasMore) {
      const beforeSeq = records[0]?.event.seq;
      if (!Number.isInteger(beforeSeq)) throw new RuntimeError(502, 'dsh/history-gap', 'Incomplete DSH journal page');
      const page = await this.peer.call('events', {address: {kind: 'session', sessionId: id}, throughSeq: opening.cursor,
        beforeSeq, maxMessages: 200});
      if (!page.records.length || page.records.at(-1).event.seq >= beforeSeq)
        throw new RuntimeError(502, 'dsh/history-gap', 'DSH history did not advance');
      records = [...page.records, ...records]; hasMore = page.hasMore;
    }
    return records;
  }
  async monitor(meta, m) {
    while (!this.closed) {
      try {
        await this.peer.connect(); await this.provision(meta);
        if (this.closed) break;
        const generation = this.peer.generation;
        m.control = new AbortController();
        const stream = this.peer.follow(meta.id, m.control.signal);
        for await (const frame of stream) {
          if (this.closed || generation !== this.peer.generation || !this.peer.connected || m.control.signal.aborted) break;
          if (frame.type === 'snapshot') {
            const records = await this.fullRecords(meta.id, frame);
            if (generation !== this.peer.generation || m.control.signal.aborted) break;
            m.projection.baseline(records, frame.cursor, generation, frame.assistantStream);
            m.active = true; this.settle(m);
            this.publish(meta.id, {type: 'snapshot', cursor: frame.cursor, data: this.currentSnapshot(m), generation});
          } else if (m.active && frame.type === 'event') {
            for (const event of m.projection.durable(frame.event)) this.publish(meta.id, {...event, generation});
          } else if (m.active && frame.type === 'assistant-stream') {
            for (const event of m.projection.live(frame.frame, generation)) this.publish(meta.id, {...event, generation});
          }
        }
        if (!this.closed) throw new RuntimeError(503, 'dsh/stream-ended', 'DSH Session stream disconnected');
      } catch (error) {
        if (this.closed) break;
        m.active = false;
        const safe = error instanceof RuntimeError ? error : new RuntimeError(503, 'dsh/stream-failed', 'DSH Session stream failed');
        this.settle(m, safe); this.publish(meta.id, {type: 'error', data: publicError(safe)});
        if (this.peer.authFailure) { m.terminalError = this.peer.authFailure; break; }
        await delay(250);
      }
    }
    this.settle(m, new RuntimeError(503, 'runtime/closed', 'Runtime closed'));
  }
  currentSnapshot(m, state) {
    const interactions = [...this.interactions.values()].filter(x => x.session_id === m.id).map(x => x.public);
    return m.projection.snapshot({interactions, inbox: state?.queue ?? [],
      ...(!this.peer.connected || !m.active ? {status: 'disconnected'}
        : state?.running && !['error', 'cancelled'].includes(m.projection.status) ? {status: 'running'} : {})});
  }
  async snapshot(id, scope) {
    const m = await this.ensure(this.get(id, scope));
    const state = await this.peer.call('state', {sessionId: id});
    return this.currentSnapshot(m, state);
  }
  publish(id, event) { this.emit('event', {...event, session_id: id,
    connection_generation: `${this.epoch}:${event.generation ?? this.peer.generation}`}); }
  normalizeMessage(input) {
    const attachments = imageParts(input.attachments);
    if (input.content !== undefined && (typeof input.content !== 'string' || input.content.length > 200000))
      throw new RuntimeError(400, 'runtime/invalid-content', 'content must be text');
    if (!input.content?.trim() && !attachments.length)
      throw new RuntimeError(400, 'runtime/invalid-content', 'A message requires text or an image');
    const mode = input.mode ?? 'queue';
    if (!['queue', 'steer'].includes(mode)) throw new RuntimeError(400, 'runtime/invalid-mode', 'mode must be queue or steer');
    return {content: input.content ?? '', mode, ...(attachments.length ? {attachments} : {})};
  }
  async message(id, input, scope) {
    const meta = this.get(id, scope); const normalized = this.normalizeMessage(input);
    if (input.request_id && input.client_request_id && input.request_id !== input.client_request_id)
      throw new RuntimeError(400, 'runtime/request-alias-conflict', 'Request identity aliases disagree');
    const requestId = input.request_id ?? input.client_request_id ?? randomUUID(); nonempty(requestId, 'request_id', 200);
    const hash = fingerprint(normalized); const existing = meta.requests[requestId];
    if (existing && existing.hash !== hash) throw new RuntimeError(409, 'runtime/request-conflict', 'request_id already has different content');
    if (!existing) {
      meta.requests[requestId] = {hash, input: normalized, status: 'intended'};
      await this.store.save();
    }
    await this.submit(meta, requestId, normalized);
    return {request_id: requestId, session_id: id, accepted: true, status: 'accepted'};
  }
  async submit(meta, requestId, input) {
    const key = `${meta.id}:${requestId}`;
    if (this.operations.has(key)) return this.operations.get(key);
    const operation = (async () => {
      const record = meta.requests[requestId];
      if (record?.status === 'accepted') return;
      await this.ensure(meta);
      const result = await this.peer.call('prompt', {sessionId: meta.id, requestId, mode: input.mode,
        content: [...(input.content?.trim() ? [{type: 'text', text: input.content}] : []), ...(input.attachments ?? [])]});
      if (result.accepted !== true) throw new RuntimeError(502, 'dsh/not-accepted', 'DSH did not accept the message');
      record.status = 'accepted'; delete record.input; await this.store.save();
    })();
    this.operations.set(key, operation);
    try { return await operation; } finally { this.operations.delete(key); }
  }
  receipt(id, requestId, scope) {
    const meta = this.get(id, scope);
    const record = Object.hasOwn(meta.requests, requestId) ? meta.requests[requestId] : undefined;
    if (!record) throw new RuntimeError(404, 'runtime/request-not-found', 'Request not found in scope');
    return {request_id: requestId, session_id: id, status: record.status, accepted: record.status === 'accepted'};
  }
  async cancel(id, scope) {
    const meta = this.get(id, scope); await this.ensure(meta);
    const result = await this.peer.call('cancel', {sessionId: id});
    if (!result.accepted) throw new RuntimeError(502, 'dsh/not-accepted', 'DSH did not accept cancellation');
    // DSH cancels only the active turn; never clear its inbox or our durable intents.
    return {session_id: id, accepted: true, status: 'cancelling'};
  }
  remoteEvent(frame, generation) {
    if (!this.peer.connected || generation !== this.peer.generation) return;
    if (frame.type === 'emit' && frame.event === 'api-session/error') {
      if (this.store.sessions.has(frame.args[0])) {
        const m = this.monitors.get(frame.args[0]); if (m) m.projection.status = 'error';
        this.publish(frame.args[0], {type: 'error', generation, data: {code: 'dsh/agent-error', message: 'DSH Agent failed'}});
      }
      return;
    }
    if (frame.type === 'cancel') {
      const id = `${this.epoch}:${generation}:${frame.eventId}`; const pending = this.interactions.get(id);
      if (pending) { this.interactions.delete(id); this.publish(pending.session_id, {
        type: 'interaction.resolved', generation, data: {request_id: id, status: 'cancelled'},
      }); }
      return;
    }
    if (frame.type !== 'waterfall') return;
    const supported = ['approval/request', 'user-questions/request'].includes(frame.event) && !frame.request?.wait?.timed;
    if (!this.store.sessions.has(frame.agentId) || !supported) {
      // Explicit delegation preserves the Host's fail-closed policy. No automatic grant.
      void this.peer.answer(frame.eventId, undefined, generation, true).catch(() => {});
      if (this.store.sessions.has(frame.agentId)) this.publish(frame.agentId, {type: 'error', generation,
        data: {code: 'runtime/interaction-unsupported', message: 'This interaction type is unsupported'}});
      return;
    }
    const id = `${this.epoch}:${generation}:${frame.eventId}`;
    if (this.interactions.has(id)) return;
    const publicValue = {id, request_id: id, kind: frame.event === 'approval/request' ? 'approval' : 'question', type: frame.event === 'approval/request' ? 'approval' : 'question',
      ...(frame.request.questions ? {questions: frame.request.questions} : {}),
      ...(frame.request.toolName ? {tool_name: frame.request.toolName} : {}),
      ...(frame.request.callId || frame.request.wait?.callId ? {call_id: frame.request.callId ?? frame.request.wait.callId} : {}),
      ...(frame.request.reason ? {reason: frame.request.reason, prompt: frame.request.reason} : {}),
      ...(frame.request.toolName ? {command: frame.request.toolName} : {})};
    this.interactions.set(id, {session_id: frame.agentId, generation, eventId: frame.eventId,
      event: frame.event, public: publicValue});
    this.publish(frame.agentId, {type: 'interaction.requested', generation, data: publicValue});
  }
  async answer(id, requestId, input, scope) {
    this.get(id, scope);
    const pending = this.interactions.get(requestId);
    if (!pending || pending.session_id !== id || pending.generation !== this.peer.generation)
      throw new RuntimeError(409, 'runtime/stale-interaction', 'Interaction is expired or belongs to another Session');
    if (pending.resolving) throw new RuntimeError(409, 'runtime/interaction-busy', 'Interaction answer is already pending');
    let answer;
    if (pending.event === 'approval/request') {
      if (!['allowed-once', 'rejected'].includes(input.decision))
        throw new RuntimeError(400, 'runtime/invalid-decision', 'decision must be allowed-once or rejected');
      answer = input.decision;
    } else {
      answer = input.answer;
      const questions = pending.public.questions;
      if (typeof answer === 'string' && questions.length === 1)
        answer = {answers: [{id: questions[0].id, selected: [], custom: answer}]};
      if (!answer || !Array.isArray(answer.answers) || answer.answers.length !== questions.length
        || questions.some(q => answer.answers.filter(a => a.id === q.id).length !== 1)
        || answer.answers.some(a => !Array.isArray(a.selected) || a.selected.some(x => typeof x !== 'string')
          || (a.custom !== undefined && typeof a.custom !== 'string')))
        throw new RuntimeError(400, 'runtime/invalid-answer', 'Answers must correlate to every question id');
    }
    pending.resolving = true;
    try { await this.peer.answer(pending.eventId, answer, pending.generation); }
    catch (e) { pending.resolving = false; throw e; }
    this.interactions.delete(requestId);
    this.publish(id, {type: 'interaction.resolved', generation: pending.generation, data: {request_id: requestId, status: 'answered'}});
    return {session_id: id, request_id: requestId, accepted: true};
  }
  async close() {
    this.closed = true;
    for (const m of this.monitors.values()) m.control?.abort();
    this.peer.off('remote-event', this.remoteListener); this.peer.off('disconnected', this.disconnectListener);
    await this.peer.close();
    await Promise.allSettled([...this.monitors.values()].map(m => m.task));
    await this.recovery; await Promise.allSettled([...this.operations.values()]);
    await this.store.close();
  }
}
