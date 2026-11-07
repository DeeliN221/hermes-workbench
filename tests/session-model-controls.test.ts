import { expect, it, vi } from 'vitest';
import { SessionModelControlsMemory } from '../dashboard/src/session-model-controls';
import { normalizeSession, updateRuntimeSessionModel } from '../dashboard/src/codex-api';

const session = (id: string, model: string, revision = 0) => normalizeSession({ id, model, model_revision: revision, reasoning_effort: 'high' })!;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

it('keeps profiles, conversations and a new draft separate', async () => {
  const memory = new SessionModelControlsMemory(), write = vi.fn();
  memory.observe('p', 'a', session('a', 'alpha'));
  memory.observe('p', 'b', session('b', 'beta'));
  memory.observe('other', 'a', session('a', 'gamma'));
  await memory.choose('p', '', { model: 'draft' }, write);
  expect(memory.value('p', 'a')?.model).toBe('alpha');
  expect(memory.value('p', 'b')?.model).toBe('beta');
  expect(memory.value('other', 'a')?.model).toBe('gamma');
  expect(write).not.toHaveBeenCalled();
  memory.clearDraft('p');
  expect(memory.value('p', '')).toBeUndefined();
});

it('serializes quick choices and rejects stale snapshots and acknowledgements', async () => {
  const memory = new SessionModelControlsMemory(), first = deferred<ReturnType<typeof session>>();
  memory.observe('p', 'a', session('a', 'default'));
  const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(session('a', 'latest', 2));
  const a = memory.choose('p', 'a', { model: 'first' }, write);
  await Promise.resolve(); await Promise.resolve();
  const b = memory.choose('p', 'a', { model: 'latest' }, write);
  expect(memory.observe('p', 'a', session('a', 'default'))).toBeUndefined();
  first.resolve(session('a', 'first', 1));
  await a; await b; await memory.flush('p', 'a');
  expect(write.mock.calls.map(([value]) => value.model)).toEqual(['first', 'latest']);
  expect(memory.value('p', 'a')?.model).toBe('latest');
  expect(memory.observe('p', 'a', session('a', 'first', 1))).toBeUndefined();
  expect(memory.observe('p', 'a', session('a', 'other-device', 3))?.model).toBe('other-device');
});

it('preserves a failed choice and blocks send until it is saved successfully', async () => {
  const memory = new SessionModelControlsMemory();
  memory.observe('p', 'a', session('a', 'default'));
  await expect(memory.choose('p', 'a', { model: 'chosen' }, async () => { throw Error('offline'); })).rejects.toThrow('offline');
  expect(memory.value('p', 'a')?.model).toBe('chosen');
  expect(memory.observe('p', 'a', session('a', 'default'))).toBeUndefined();
  await expect(memory.flush('p', 'a')).rejects.toThrow('offline');
  await memory.choose('p', 'a', { model: 'chosen' }, async () => session('a', 'chosen', 1));
  await expect(memory.flush('p', 'a')).resolves.toBeUndefined();
});

it('keeps a newer selection from another device when a local acknowledgement arrives late', async () => {
  const memory = new SessionModelControlsMemory(), response = deferred<ReturnType<typeof session>>();
  const save = memory.choose('p', 'a', { model: 'local' }, async () => response.promise);
  memory.observe('p', 'a', session('a', 'other-device', 2));
  response.resolve(session('a', 'local', 1));
  expect(await save).toMatchObject({ model: 'other-device' });
  expect(memory.value('p', 'a')?.model).toBe('other-device');
});

it('does not surface an obsolete failed write after a newer choice succeeds', async () => {
  const memory = new SessionModelControlsMemory();
  let reject!: (error: Error) => void;
  const first = new Promise<ReturnType<typeof session>>((_, fail) => { reject = fail; });
  const old = memory.choose('p', 'a', { model: 'old' }, async () => first);
  await Promise.resolve(); await Promise.resolve();
  const latest = memory.choose('p', 'a', { model: 'latest' }, async () => session('a', 'latest', 2));
  reject(Error('obsolete failure'));
  await expect(old).resolves.toBeUndefined();
  await latest; await memory.flush('p', 'a');
  expect(memory.value('p', 'a')?.model).toBe('latest');
});

it('writes the owned session immediately and requires the runtime acknowledgement', async () => {
  const read = vi.fn(async () => ({ session: { id: 'a', model: 'chosen', model_revision: 4, reasoning_effort: 'high' } }));
  expect(await updateRuntimeSessionModel(read as any, 'profile', 'a', { model: 'chosen', effort: 'high' })).toMatchObject({ model: 'chosen', modelRevision: 4 });
  expect(read.mock.calls[0]).toEqual(['/api/runtime/sessions/a/model?profile_id=profile', expect.objectContaining({ method: 'POST', body: JSON.stringify({ model: 'chosen', reasoning_effort: 'high' }) })]);
  await expect(updateRuntimeSessionModel(async () => ({}) as any, 'p', 'a', { model: 'chosen' })).rejects.toThrow('did not confirm');
});
