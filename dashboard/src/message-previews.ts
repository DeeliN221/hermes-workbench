/** Carry local attachment thumbnails across server snapshots for the same request. */

export type PreviewCarrier = {
  id?: unknown;
  clientRequestId?: unknown;
  clientId?: unknown;
  attachments?: readonly unknown[];
};

export function applyMessagePreviews<T extends PreviewCarrier>(
  previous: readonly PreviewCarrier[] | null | undefined,
  incoming: T[],
): T[] {
  const previews = new Map<string, readonly unknown[]>();
  for (const message of previous || []) {
    if (!Array.isArray(message.attachments) || !message.attachments.length) continue;
    for (const id of [message.id, message.clientRequestId, message.clientId]) {
      if (id) previews.set(String(id), message.attachments);
    }
  }
  if (!previews.size || !Array.isArray(incoming)) return incoming;
  return incoming.map((message) => {
    const key = [message.id, message.clientRequestId, message.clientId]
      .map((value) => (value ? String(value) : ''))
      .find((value) => value && previews.has(value));
    return key ? { ...message, attachments: previews.get(key) } as T : message;
  });
}
