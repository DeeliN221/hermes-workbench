import {spawn} from 'node:child_process';
import {open, readFile, chmod, stat, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {installHostExtension} from './host-config.mjs';
import {RuntimeError} from './errors.mjs';
export async function privateFile(path) {
  const s = await stat(path);
  if (!s.isFile() || (s.mode & 0o077) !== 0)
    throw new RuntimeError(503, 'runtime/private-file-required', 'Runtime credentials/log must be an owner-only file');
  return readFile(path, 'utf8');
}
export async function tokenFromLog(log) {
  const text = await privateFile(log);
  const tokens = [...text.matchAll(/dsh web: http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/\?token=([^\s&]+)/g)];
  if (!tokens.length) throw new RuntimeError(503, 'dsh/host-not-ready', 'DSH Host launch token is not ready');
  return decodeURIComponent(tokens.at(-1)[1]);
}
export async function startHost({modules, home, state, port = 38471, cwd = state, onPid = async () => {}}) {
  await mkdir(state, {recursive: true, mode: 0o700}); await chmod(state, 0o700);
  try { await privateFile(join(home, 'settings.yaml')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; await privateFile(join(home, 'profiles/web/cordis.patch.yml')); }
  await privateFile(join(home, '.env'));
  await installHostExtension(home, modules);
  const log = join(state, 'host.log');
  const env = {...process.env, DSH_HOME: home}; delete env.DEEPSEEK_API_KEY;
  let child, closing = false, restarting = false, restartTask, closingTask;
  async function terminate(process) {
    if (!process || process.exitCode !== null || process.signalCode !== null) return;
    process.kill('SIGTERM');
    for (let i = 0; i < 50 && process.exitCode === null && process.signalCode === null; i++) await delay(100);
    if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
  }
  async function launch() {
    if (closing) throw new RuntimeError(503, 'dsh/host-closed', 'DSH Host is shutting down');
    const handle = await open(log, 'w', 0o600); await chmod(log, 0o600);
    let process, failure, ready = false;
    try {
      process = child = spawn(globalThis.process.execPath, [modules.cli, 'web', '--no-open', '--port', String(port)], {
        env, cwd, stdio: ['ignore', handle.fd, handle.fd],
      });
    } finally { await handle.close(); }
    process.on('error', error => { failure = error; });
    process.once('exit', () => {
      if (ready && !closing && !restarting) restartTask = recover();
    });
    await onPid(process.pid);
    try {
      for (let i = 0; i < 150 && !closing; i++) {
        if (failure || process.exitCode !== null || process.signalCode !== null)
          throw new RuntimeError(503, 'dsh/host-exited', 'Isolated DSH Host failed; inspect its private log');
        try { await tokenFromLog(log); ready = true; return; }
        catch (e) { if (e.code !== 'dsh/host-not-ready') throw e; }
        await delay(100);
      }
      throw new RuntimeError(503, 'dsh/host-timeout', 'Isolated DSH Host startup timed out');
    } catch (e) { await terminate(process); throw e; }
  }
  async function recover() {
    restarting = true;
    try {
      for (let attempt = 0; attempt < 3 && !closing; attempt++) {
        await delay(250);
        try { await launch(); return; } catch { /* bounded private Host restart attempts */ }
      }
    } finally { restarting = false; }
  }
  const close = () => closingTask ??= (async () => {
    closing = true; await terminate(child); await restartTask; await terminate(child);
  })();
  try { await launch(); }
  catch (e) { await close(); throw e; }
  return {url: `http://127.0.0.1:${port}`, readToken: () => tokenFromLog(log), close, get pid() { return child?.pid; }};
}
