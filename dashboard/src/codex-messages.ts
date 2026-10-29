/** Normalize native snapshots and incremental notifications into stable chat state. */
import { record, text, firstDefined, optionalNumber, timestamp, type JsonRecord } from './api-values';
import { uiText } from './ui-locale';
import { visibleChatText } from './chat-line-output';
import { sameMessage, withTurnError } from './chat-runtime-errors';

export type MessageStatus = 'running' | 'completed' | 'failed' | 'accepted' | 'pending';
export type TurnStatus = 'running' | 'completed' | 'failed';
export interface MessageAttachmentPreview { id: string; name: string; src: string }
export interface ChatMessage {
  id: string; itemId?: string; clientId?: unknown; clientRequestId?: string; turnId?: string;
  role: string; content: string; paragraphs?: string[]; status?: MessageStatus; phase?: 'commentary' | 'final';
  toolName?: string; input?: unknown; result?: unknown; exitCode?: number | null; durationMs?: number | null;
  turnDurationMs?: number | null; turnStatus?: TurnStatus; turnStartedAt?: number; observedAt?: number;
  turnCompletedAt?: number; weeklyRemainingPercent?: number; suppressDeltas?: boolean; error?: boolean;
  submissionError?: unknown; runtimeError?: unknown; delivery?: unknown; questions?: unknown;
  attachments?: MessageAttachmentPreview[];
  subagent?: {
    tool: string;
    prompt?: string;
    receiverThreadIds: string[];
    receiverAgents: unknown[];
    agentsStates?: unknown;
  };
}
export function messageStatus(value: unknown): MessageStatus | undefined {
  const status = text(value).toLowerCase();
  if (!status) return undefined;
  if (status.includes('run') || ['processing', 'in_progress', 'inprogress'].includes(status)) return 'running';
  if (['fail', 'error', 'interrupt', 'declin', 'cancel'].some(part => status.includes(part))) return 'failed';
  if (status.includes('complete') || ['done', 'success', 'succeeded'].includes(status)) return 'completed';
  if (status.includes('accept')) return 'accepted';
  if (status.includes('pend')) return 'pending';
}
export function turnStatus(value: unknown): TurnStatus | undefined {
  const status = messageStatus(value);
  return status === 'running' || status === 'completed' || status === 'failed' ? status : undefined;
}
export function messagePhase(value: unknown): 'commentary' | 'final' | undefined {
  const phase = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (['commentary', 'analysis', 'reasoning'].includes(phase)) return 'commentary';
  if (['final', 'final_answer', 'answer'].includes(phase)) return 'final';
}
export function itemStatus(item: JsonRecord, fallback?: MessageStatus): MessageStatus | undefined {
  const status = messageStatus(item.status), exitCode = optionalNumber(firstDefined(item, 'exitCode', 'exit_code'));
  if (item.error === true || status === 'failed') return 'failed';
  if (exitCode != null) return exitCode !== 0 ? 'failed' : status === 'running' ? 'completed' : status || 'completed';
  return status || fallback;
}
export function completedItemStatus(item: JsonRecord, fallback?: MessageStatus): MessageStatus | undefined {
  const status = messageStatus(item.status), exitCode = optionalNumber(firstDefined(item, 'exitCode', 'exit_code'));
  if (item.error === true || status === 'failed') return 'failed';
  if (exitCode != null) return exitCode === 0 ? 'completed' : 'failed';
  return status === 'running' ? fallback : status || fallback;
}
export function contentText(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value)
    ? value.map(value => typeof value === 'string' ? value : text(record(value).text)).join('') : '';
}
function attachmentName(path: string) { return path.trim().split(/[\\/]/).filter(Boolean).at(-1) || path.trim() || uiText('附件', 'Attachments'); }
export function userContentText(value: unknown): string {
  if (!Array.isArray(value)) return contentText(value);
  let content = '';
  for (const part of value) {
    if (typeof part === 'string') { content += part; continue; }
    const row = record(part), type = text(row.type).toLowerCase();
    let label: string | undefined;
    if (type === 'localimage') {
      const name = attachmentName(text(row.path ?? row.name ?? row.filename));
      label = uiText(`附件：${name}`, `Attachment: ${name}`);
    } else if (type === 'text' && typeof row.text === 'string') {
      const match = row.text.match(/^(?:User attachment: |用户附件：)([^\r\n]*)\r?\n(?:Path: |路径：)([^\r\n]+)$/);
      if (match) { const name = match[1].trim() || attachmentName(match[2]); label = uiText(`附件：${name}`, `Attachment: ${name}`); }
    }
    if (label) { if (content && !content.endsWith('\n')) content += '\n'; content += label; }
    else content += contentText(row.text);
  }
  return content;
}
export function normalizeMessage(value: unknown, fallbackId: string): ChatMessage | null {
  const item = record(value);
  if (!Object.keys(item).length) return null;
  const type = text(item.type), role = text(item.role), nested = record(item.message);
  const itemId = text(item.itemId ?? item.id, fallbackId);
  const user = type === 'userMessage' || role === 'user', reasoning = type === 'reasoning' || role === 'reasoning';
  const collabAgent = type === 'collabAgentToolCall';
  const tool = role === 'tool' || ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'imageView', 'collabAgentToolCall'].includes(type);
  const receiverThreadIdsValue = item.receiverThreadIds ?? item.receiver_thread_ids;
  const receiverAgentsValue = item.receiverAgents ?? item.receiver_agents;
  const receiverThreadIds: string[] = Array.isArray(receiverThreadIdsValue)
    ? receiverThreadIdsValue.map((value: unknown) => text(value)).filter(Boolean)
    : [];
  const receiverAgents: unknown[] = Array.isArray(receiverAgentsValue) ? receiverAgentsValue : [];
  const subagent = collabAgent ? {
    tool: text(item.tool) || 'collaboration',
    prompt: text(item.prompt) || undefined,
    receiverThreadIds,
    receiverAgents,
    agentsStates: item.agentsStates ?? item.agents_states,
  } : undefined;
  const inputContent = Array.isArray(item.content) && item.content.length ? item.content : item.text ?? item.content;
  const result = tool ? collabAgent ? item.result ?? item.agentsStates ?? item.agents_states : item.result ?? item.aggregatedOutput ?? item.output ?? item.content : undefined;
  const collabSummary = collabAgent ? [
    subagent?.tool,
    subagent?.prompt,
    subagent?.receiverThreadIds.length ? `${subagent.receiverThreadIds.length} subagent(s)` : '',
  ].filter(Boolean).join(': ') : '';
  const content = user ? userContentText(inputContent) : reasoning
    ? Array.isArray(item.summary) ? item.summary.map(contentText).join('\n\n') : contentText(item.content)
    : collabAgent ? collabSummary : contentText(tool ? result : item.text ?? item.content);
  const status = itemStatus(item), exitCode = optionalNumber(firstDefined(item, 'exitCode', 'exit_code'));
  const attachments = Array.isArray(item.attachments) ? item.attachments.flatMap(value => {
    const row = record(value), id = text(row.id), name = text(row.name), src = text(row.src);
    return id && src && (src.startsWith('blob:') || src.startsWith('data:image/')) ? [{ id, name, src }] : [];
  }) : undefined;
  const message: ChatMessage = {
    id: user ? text(item.clientId, role ? text(item.id, itemId) : itemId) : itemId, itemId,
    clientId: item.clientId, submissionError: item.submissionError, runtimeError: item.runtimeError,
    turnId: text(item.turnId) || undefined, role: user ? 'user' : reasoning ? 'reasoning' : tool ? 'tool' : role || 'assistant',
    delivery: item.delivery, questions: item.questions, content, status, phase: messagePhase(item.phase ?? nested.phase),
    attachments,
    toolName: text(item.toolName ?? (collabAgent ? 'collab_agent_tool_call' : item.tool) ?? (type === 'commandExecution' ? uiText('终端', 'Terminal') : tool ? type : '')) || undefined,
    input: collabAgent ? subagent : item.input ?? item.command ?? item.arguments ?? item.changes, result, exitCode, subagent,
    durationMs: optionalNumber(firstDefined(item, 'durationMs', 'duration_ms')),
    turnDurationMs: optionalNumber(firstDefined(item, 'turnDurationMs', 'turn_duration_ms')),
    turnStatus: turnStatus(item.turnStatus), turnStartedAt: timestamp(firstDefined(item, 'turnStartedAt', 'turn_started_at')),
    observedAt: timestamp(item.observedAt), turnCompletedAt: timestamp(item.turnCompletedAt),
    weeklyRemainingPercent: typeof item.weeklyRemainingPercent === 'number' ? item.weeklyRemainingPercent : undefined,
    error: item.error === true || status === 'failed' || (exitCode != null && exitCode !== 0), suppressDeltas: item.suppressDeltas === true,
  };
  message.paragraphs = visibleChatText(message).split(/\n{2,}/).filter(Boolean);
  return message;
}
export function mergeMessage(previous: ChatMessage, next: ChatMessage): ChatMessage {
  const subagent = next.subagent ?? previous.subagent;
  return normalizeMessage({
    ...previous, ...next, status: next.status ?? previous.status, phase: next.phase ?? previous.phase,
    attachments: next.attachments ?? previous.attachments,
    type: subagent ? 'collabAgentToolCall' : undefined,
    tool: subagent?.tool,
    prompt: subagent?.prompt,
    receiverThreadIds: subagent?.receiverThreadIds,
    receiverAgents: subagent?.receiverAgents,
    agentsStates: subagent?.agentsStates,
    input: next.input !== undefined ? next.input : previous.input, toolName: next.toolName ?? previous.toolName,
    turnId: next.turnId ?? previous.turnId, exitCode: next.exitCode !== undefined ? next.exitCode : previous.exitCode,
    durationMs: next.durationMs !== undefined ? next.durationMs : previous.durationMs,
    result: next.result !== undefined ? next.result : previous.result,
    turnDurationMs: next.turnDurationMs !== undefined ? next.turnDurationMs : previous.turnDurationMs,
    turnStatus: next.turnStatus ?? previous.turnStatus, observedAt: next.observedAt ?? previous.observedAt,
    turnCompletedAt: next.turnCompletedAt ?? previous.turnCompletedAt,
    weeklyRemainingPercent: next.weeklyRemainingPercent ?? previous.weeklyRemainingPercent,
    turnStartedAt: next.turnStartedAt !== undefined ? next.turnStartedAt : previous.turnStartedAt,
    subagent,
  }, next.id)!; // A normalized message always contains an identity and content.
}
export function notification(value: unknown) {
  const event = record(value), payload = event.payload ? record(event.payload) : event;
  return { method: text(event.method ?? payload.method), params: record(payload.params) };
}
export function messageFromNotification(value: unknown, fallbackId: string): ChatMessage | null {
  const event = record(value), { method, params } = notification(event);
  if (!params.item || !['item/started', 'item/completed'].includes(method)) return null;
  const item = record(params.item), turn = record(params.turn);
  const duration = firstDefined(params, 'turnDurationMs', 'turn_duration_ms'), started = firstDefined(params, 'turnStartedAt', 'turn_started_at');
  return normalizeMessage({ ...item, observedAt: item.observedAt ?? timestamp(event.created_at), turnId: params.turnId ?? params.turn_id,
    turnDurationMs: duration === undefined ? firstDefined(turn, 'durationMs', 'duration_ms') : duration,
    turnStartedAt: started === undefined ? firstDefined(turn, 'startedAt', 'started_at') : started,
    turnStatus: turnStatus(turn.status), status: itemStatus(item, method === 'item/completed' ? 'completed' : 'running'),
  }, fallbackId);
}
export function messagesFromTurns(turns: unknown[], sessionId: string): ChatMessage[] {
  return turns.flatMap((value, turnIndex) => {
    const turn = record(value), status = messageStatus(turn.status), state = turnStatus(turn.status) || 'completed';
    const duration = optionalNumber(firstDefined(turn, 'durationMs', 'duration_ms'));
    const started = timestamp(firstDefined(turn, 'startedAt', 'started_at', 'turnStartedAt', 'turn_started_at'));
    const messages = (Array.isArray(turn.items) ? turn.items : []).flatMap((value, itemIndex) => {
      const item = record(value), itemState = item.type === 'userMessage' ? 'completed' : itemStatus(item, status || 'completed');
      const message = normalizeMessage({ ...item, status: itemState, turnId: turn.id, turnDurationMs: duration, turnStartedAt: started,
        turnCompletedAt: timestamp(turn.completedAt ?? turn.completed_at) ?? (state !== 'running' && started !== undefined && duration != null ? started + duration : undefined),
        weeklyRemainingPercent: turn.weeklyRemainingPercent, turnStatus: state,
      }, `${sessionId}:${turnIndex}:${itemIndex}`);
      return message ? [{ ...message, suppressDeltas: itemState === 'running' }] : [];
    });
    return withTurnError(messages, turn);
  });
}
export function applyChatEvent(messages: ChatMessage[], value: unknown): ChatMessage[] {
  const event = record(value), { method, params } = notification(event);
  if (method === 'workbench/turnMetrics') return messages.map(message => message.turnId === params.turnId ? {
    ...message, turnCompletedAt: timestamp(params.completedAt),
    weeklyRemainingPercent: typeof params.weeklyRemainingPercent === 'number' ? params.weeklyRemainingPercent : undefined,
  } : message);
  if (method === 'turn/completed' || method === 'turn/failed') {
    const turn = record(params.turn), state = turnStatus(turn.status) || 'completed';
    const duration = optionalNumber(firstDefined(turn, 'durationMs', 'duration_ms'));
    const started = timestamp(firstDefined(turn, 'startedAt', 'started_at', 'turnStartedAt', 'turn_started_at'));
    const id = text(turn.id ?? params.turnId ?? params.turn_id);
    return withTurnError(messages.map(message => {
      if (message.turnId !== id) return message;
      const status = message.status === 'running'
        ? message.role === 'tool' ? completedItemStatus({ ...message }, state) : state === 'failed' ? 'failed' : 'completed'
        : message.status;
      return normalizeMessage({ ...message, status, turnDurationMs: duration !== undefined ? duration : message.turnDurationMs,
        turnStatus: state, turnCompletedAt: timestamp(turn.completedAt ?? turn.completed_at ?? event.created_at) ?? Date.now(),
        turnStartedAt: started !== undefined ? started : message.turnStartedAt, suppressDeltas: false,
      }, message.id)!;
    }), { ...turn, id, status: method === 'turn/failed' ? 'failed' : state });
  }
  if (method === 'turn/started') {
    const turn = record(params.turn), id = text(turn.id ?? params.turnId ?? params.turn_id);
    const start = firstDefined(turn, 'startedAt', 'started_at', 'turnStartedAt', 'turn_started_at');
    const started = timestamp(start === undefined ? firstDefined(params, 'turnStartedAt', 'turn_started_at') : start);
    return id ? messages.map(message => message.turnId === id
      ? normalizeMessage({ ...message, turnStatus: 'running', turnStartedAt: started ?? message.turnStartedAt }, message.id)! : message) : messages;
  }
  if (method === 'item/reasoning/textDelta') return messages;
  if (method === 'item/reasoning/summaryPartAdded') return messages.map(message =>
    message.itemId === params.itemId && message.content && !message.suppressDeltas
      ? normalizeMessage({ ...message, content: message.content + '\n\n' }, message.id)! : message);
  if (method.toLowerCase().endsWith('delta')) {
    const id = text(params.itemId);
    if (!id || typeof params.delta !== 'string') return messages;
    const index = messages.findIndex(message => message.itemId === id || message.id === id), previous = messages[index];
    if (previous?.suppressDeltas || previous?.status === 'completed' || previous?.status === 'failed') return messages;
    const message = normalizeMessage({ ...previous, id: previous?.id || id, itemId: id, turnId: params.turnId,
      role: previous?.role || (method.includes('reasoning') ? 'reasoning' : method.includes('commandExecution') ? 'tool' : 'assistant'),
      content: (previous?.content || '') + params.delta, status: 'running', result: undefined,
    }, id)!;
    return index < 0 ? [...messages, message] : messages.map((previous, at) => at === index ? message : previous);
  }
  const rawMessage = record(event.message);
  const incoming = event.message
    ? normalizeMessage({ ...rawMessage, turnId: rawMessage.turnId ?? params.turnId ?? params.turn_id }, text(event.requestId))
    : messageFromNotification(event, text(params.itemId));
  if (!incoming) return messages;
  const index = messages.findIndex(message => sameMessage(message, incoming));
  const previousTurn = incoming.turnId ? messages.find(message => message.turnId === incoming.turnId) : undefined;
  const message = previousTurn ? { ...incoming,
    turnDurationMs: incoming.turnDurationMs !== undefined ? incoming.turnDurationMs : previousTurn.turnDurationMs,
    turnStartedAt: incoming.turnStartedAt ?? previousTurn.turnStartedAt, turnStatus: incoming.turnStatus ?? previousTurn.turnStatus,
  } : incoming;
  if (index < 0) return [...messages, message];
  if (method === 'item/started' && messages[index].status !== 'pending') return messages;
  return messages.map((previous, at) => at === index ? mergeMessage(previous, message) : previous);
}
