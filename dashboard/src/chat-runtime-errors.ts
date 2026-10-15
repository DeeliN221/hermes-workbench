import { uiText as sourceText } from './ui-locale';
import { record, timestamp } from './api-values';
import type { ChatMessage } from './codex-messages';
/** Preserve runtime diagnostics and reconcile transport requests with native messages. */
export function runtimeErrorText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    try { return runtimeErrorText(JSON.parse(value)); } catch { return value; }
  }
  const error = record(value), message = typeof error.message === 'string' ? error.message : '';
  const code = error.codexErrorInfo ?? error.code;
  const details = error.additionalDetails;
  return [message, code == null ? '' : typeof code === 'object' ? JSON.stringify(code) : String(code),
    typeof details === 'string' ? details : ''].filter(Boolean).join('\n');
}

type MessageIdentity = { id?: string; itemId?: string; clientId?: unknown; clientRequestId?: string };
export function sameMessage(a: MessageIdentity, b: MessageIdentity): boolean {
  const ids = (message: MessageIdentity) => [message.id, message.itemId, message.clientId, message.clientRequestId].filter(Boolean);
  return ids(a).some(id => ids(b).includes(id));
}

export function insertRequest<T extends MessageIdentity & { turnStartedAt?: number }>(messages: T[], request: T): T[] {
  if (messages.some(message => sameMessage(message, request))) return messages;
  const index = messages.findIndex(message => message.turnStartedAt && request.turnStartedAt &&
    message.turnStartedAt > request.turnStartedAt);
  return index < 0 ? [...messages, request] : [...messages.slice(0, index), request, ...messages.slice(index)];
}

export function withTurnError(messages: ChatMessage[], value: unknown): ChatMessage[] {
  const turn = record(value);
  if (turn.status !== 'failed' || !turn.id) return messages;
  const id = `runtime-error:${turn.id}`;
  const content = runtimeErrorText(turn.error) || sourceText('回复失败：运行时未提供错误详情', 'Response failed: the runtime supplied no error details');
  const row: ChatMessage = { id, itemId: id, turnId: String(turn.id), role: 'assistant', phase: 'final',
    status: 'completed', runtimeError: content, content, turnStatus: 'failed',
    turnStartedAt: timestamp(turn.startedAt), paragraphs: [content] };
  const result = messages.filter(message => message.id !== id);
  let index = -1;
  result.forEach((message, at) => { if (message.turnId === turn.id) index = at; });
  if (index < 0) return insertRequest(result, row);
  result.splice(index + 1, 0, row);
  return result;
}
