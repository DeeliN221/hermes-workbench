export type ProcessTiming = { running: boolean; startedAt?: number; duration?: number; completedAt?: number; weeklyRemainingPercent?: number };
export interface ProcessMessage {
  role?: string;
  phase?: string;
  content?: string;
  observedAt?: number;
  turnStartedAt?: number;
  turnCompletedAt?: number;
  turnDurationMs?: number;
  weeklyRemainingPercent?: number;
  turnStatus?: string;
  status?: string;
}
/** Hidden system and empty assistant markers do not separate visible tool runs. */
export function visibleProcessMessages<T extends ProcessMessage>(messages: T[]): T[] {
  return messages.filter(message =>
    message.role !== 'system' &&
    !((message.role === 'reasoning' || message.role === 'assistant' || message.phase === 'commentary') &&
      message.role !== 'tool' && !message.content?.trim()));
}

/** Group each turn within a user-message segment; steering is a chronological boundary. */
export function processBlocks<T extends ProcessMessage & { id: string; turnId?: string }>(input: T[]) {
  const messages = visibleProcessMessages(input);
  const isProcess = (m: T) => m.role === 'tool' || m.role === 'reasoning' || m.phase === 'commentary';
  type Group = { kind: 'process'; key: string; messages: T[]; hasFollowingBody: boolean; segmentStartedAt?: number; segmentEndedAt?: number; closed: boolean; steered: boolean; timing?: ProcessTiming };
  const groups = new Map<string, Group>();
  const blocks: ({ kind: 'message'; message: T } | Group)[] = [];
  let segmentStartedAt: number | undefined;
  const seenTurns = new Set<string>();

  for (const message of messages) {
    if (!isProcess(message)) {
      if (message.role === 'user') {
        // Later events must never be pulled ahead of a steering instruction.
        // Optimistic user messages may not have a turnId yet.
        for (const group of groups.values()) {
          group.hasFollowingBody = true;
          const completion = group.messages.find(m => m.turnCompletedAt !== undefined)?.turnCompletedAt;
          const sameTurn = message.turnId !== undefined && message.turnId === group.messages[0].turnId;
          const alreadyCompleted = completion !== undefined && !sameTurn &&
            (message.observedAt === undefined || completion <= message.observedAt);
          group.closed = !alreadyCompleted;
          group.segmentEndedAt = alreadyCompleted ? undefined : message.observedAt;
        }
        segmentStartedAt = message.observedAt;
        groups.clear();
      }
      blocks.push({ kind: 'message', message });
      if (message.turnId && message.role === 'assistant') {
        const group = groups.get(message.turnId);
        if (group) group.hasFollowingBody = true;
      }
      continue;
    }
    const key = message.turnId || message.id;
    let group = groups.get(key);
    if (!group) {
      group = { kind: 'process', key: `${key}:${message.id}`, messages: [], hasFollowingBody: false, segmentStartedAt, closed: false, steered: seenTurns.has(key) };
      seenTurns.add(key);
      groups.set(key, group);
      blocks.push(group);
    }
    group.messages.push(message);
  }
  for (const block of blocks) {
    if (block.kind !== 'process') continue;
    const first = block.messages[0];
    const completedAt = block.closed ? undefined : block.messages.find(m => m.turnCompletedAt !== undefined)?.turnCompletedAt;
    const startedAt = block.segmentStartedAt ?? (block.steered ? first.observedAt : first.turnStartedAt ?? first.observedAt);
    const end = block.closed ? block.segmentEndedAt : completedAt;
    const duration = end !== undefined && startedAt !== undefined ? Math.max(0, end - startedAt)
      : !block.closed && !block.steered ? block.messages.find(m => m.turnDurationMs !== undefined)?.turnDurationMs : undefined;
    block.timing = {
      startedAt, duration, completedAt,
      running: !block.closed && completedAt === undefined && block.messages.some(m => m.turnStatus === 'running' || m.status === 'running'),
      weeklyRemainingPercent: block.closed ? undefined : block.messages.find(m => m.weeklyRemainingPercent !== undefined)?.weeklyRemainingPercent,
    };
  }
  return blocks;
}
