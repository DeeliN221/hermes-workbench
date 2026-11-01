import { createCodexSession, sendCodexMessage } from './codex-api';
import type { FetchJSON } from './workbench-api';
/** Keep retries on the same session/request; never inherit the selected profile. */
export function homeSubmission(read: FetchJSON, text: string) {
  const requestId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  let created = '';
  return async () => {
    if (!created) created = (await createCodexSession(read, 'default', { sessionId })).id;
    const result = await sendCodexMessage(read, 'default', created, text, requestId, {});
    if (!result.accepted) throw new Error(result.error || result.status || 'Message was not accepted');
    return created;
  };
}
