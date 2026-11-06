import {mkdir, readFile, writeFile, rename, open, chmod, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {RuntimeError} from './errors.mjs';

export class Store {
  constructor(directory) { this.directory = resolve(directory); this.sessions = new Map(); this.writes = Promise.resolve(); }
  async init() {
    await mkdir(this.directory, {recursive: true, mode: 0o700}); await chmod(this.directory, 0o700);
    this.lockPath = join(this.directory, 'bridge.lock');
    try { this.lock = await open(this.lockPath, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(await readFile(this.lockPath, 'utf8'));
      try { process.kill(pid, 0); }
      catch (e) {
        if (e.code === 'ESRCH') { await unlink(this.lockPath); return this.init(); }
        throw e;
      }
      throw new RuntimeError(503, 'runtime/writer-held', 'Bridge state is already in use');
    }
    await this.lock.writeFile(String(process.pid));
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'metadata.json'), 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.sessions)) throw Error('Invalid metadata');
      for (const session of data.sessions) this.sessions.set(session.id, session);
    } catch (e) { if (e.code !== 'ENOENT') { await this.close(); throw e; } }
  }
  async save() {
    const data = JSON.stringify({version: 1, sessions: [...this.sessions.values()]});
    const write = this.writes.then(async () => {
      const temporary = join(this.directory, 'metadata.json.tmp');
      const handle = await open(temporary, 'w', 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, join(this.directory, 'metadata.json'));
      const dir = await open(this.directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    });
    this.writes = write.catch(() => {}); return write;
  }
  async close() {
    await this.writes;
    if (this.lock) { await this.lock.close(); this.lock = undefined; await unlink(this.lockPath); }
  }
}
