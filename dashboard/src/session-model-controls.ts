import type { CodexSession } from './codex-api';

export type SessionModelControls = { model: string; effort?: string };
type Entry = { value?: SessionModelControls; remote?: CodexSession; local: number; server: number; dirty: boolean; error?: unknown; tail: Promise<unknown> };

/** Per-pane optimistic state; the runtime remains the durable source of truth. */
export class SessionModelControlsMemory {
  private entries = new Map<string, Entry>();
  private entry(profile: string, session: string): Entry {
    const key = JSON.stringify([profile, session]);
    let entry = this.entries.get(key);
    if (!entry) { entry = { local: 0, server: -1, dirty: false, tail: Promise.resolve() }; this.entries.set(key, entry); }
    return entry;
  }
  value(profile: string, session: string) { return this.entry(profile, session).value; }
  edited(profile: string, session: string) { return this.entry(profile, session).local > 0; }
  clearDraft(profile: string) { this.entries.delete(JSON.stringify([profile, ''])); }
  observe(profile: string, session: string, row: CodexSession): SessionModelControls | undefined {
    const entry = this.entry(profile, session), revision = row.modelRevision ?? 0;
    if (row.id !== session || !row.model || revision < entry.server) return;
    if (entry.dirty) {
      if (revision >= (entry.remote?.modelRevision ?? -1)) entry.remote = row;
      return;
    }
    entry.server = revision;
    return entry.value = { model: row.model, effort: row.reasoningEffort };
  }
  choose(profile: string, session: string, value: SessionModelControls,
    write: (value: SessionModelControls) => Promise<CodexSession>): Promise<SessionModelControls | undefined> {
    const entry = this.entry(profile, session), revision = ++entry.local;
    entry.value = value; entry.error = undefined; entry.dirty = !!session;
    if (!session) return Promise.resolve(value);
    // Serialize writes for one session so a slow first choice cannot win last.
    const operation = entry.tail.catch(() => {}).then(async () => {
      if (revision !== entry.local) return;
      try {
        const saved = await write(value);
        entry.server = Math.max(entry.server, saved.modelRevision ?? 0);
        if (revision !== entry.local) return;
        entry.dirty = false;
        const latest = entry.remote && (entry.remote.modelRevision ?? 0) > (saved.modelRevision ?? 0) ? entry.remote : saved;
        entry.remote = undefined;
        return this.observe(profile, session, latest);
      } catch (error) {
        if (revision !== entry.local) return;
        entry.error = error;
        throw error;
      }
    });
    entry.tail = operation;
    return operation;
  }
  async flush(profile: string, session: string) {
    const entry = this.entry(profile, session);
    let tail: Promise<unknown>;
    do { tail = entry.tail; await tail; } while (tail !== entry.tail);
    if (entry.error) throw entry.error;
    if (!entry.value?.model) throw new Error('The session model is still loading. Wait or choose a model before sending.');
  }
}
