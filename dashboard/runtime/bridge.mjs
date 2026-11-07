#!/usr/bin/env node
import {homedir} from 'node:os';
import {writeFile, unlink, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {loadDsh, DshPeer} from './dsh-peer.mjs';
import {startHost, tokenFromLog, privateFile} from './host.mjs';
import {Store} from './store.mjs';
import {Runtime} from './runtime.mjs';
import {startHttp} from './http.mjs';
import {bridgeToken} from './auth.mjs';
import {publicError} from './errors.mjs';

process.umask(0o077);
const state = resolve(process.env.WORKBENCH_DSH_STATE ?? join(homedir(), '.local/state/workbench-dsh-mac/runtime'));
let modules;
let host, runtime, http, store;
let closing;
async function close() {
  if (closing) return closing;
  closing = (async () => { await http?.close(); await runtime?.close(); if (!runtime) await store?.close(); await host?.close();
    const path = join(state, 'bridge-process.json');
    try { const current = JSON.parse(await readFile(path, 'utf8')); if (current.pid === process.pid) await unlink(path); } catch {}
  })();
  return closing;
}
try {
  if (process.env.DSH_MODULE_ROOT) modules = await loadDsh(process.env.DSH_MODULE_ROOT);
  else {
    try { modules = await loadDsh(); }
    catch (error) {
      if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
      modules = await loadDsh(join(state, 'install'));
    }
  }
  const auth = await bridgeToken(process.env.WORKBENCH_DSH_BRIDGE_TOKEN_FILE ?? join(state, 'bridge.token'));
  store = new Store(join(state, 'bridge-state')); await store.init();
  let url = process.env.DSH_HOST_URL; let readToken;
  if (url) {
    if (process.env.DSH_HOST_TOKEN_FILE) readToken = async () => (await privateFile(process.env.DSH_HOST_TOKEN_FILE)).trim();
    else if (process.env.DSH_HOST_LOG) readToken = () => tokenFromLog(process.env.DSH_HOST_LOG);
    else throw Error('External DSH Host requires a private token file or launch log');
  } else {
    host = await startHost({modules, home: resolve(process.env.DSH_HOME ?? join(state, 'dsh-home')), state,
      port: Number(process.env.DSH_HOST_PORT ?? 38471), onPid: async host_pid => {
        await writeFile(join(state, 'bridge-process.json'), JSON.stringify({owner: 'workbench-dsh-runtime', pid: process.pid, host_pid}), {mode: 0o600});
      }});
    ({url, readToken} = host);
  }
  runtime = new Runtime({peer: new DshPeer({url, readToken, modules}), store,
    provider: process.env.DSH_PROVIDER ?? 'magpie-responses', model: process.env.DSH_MODEL ?? 'codex/gpt-6.1-sol'});
  await runtime.init();
  http = await startHttp(runtime, {port: Number(process.env.PORT ?? 38472),
    authenticate: auth.authenticate, allowedOrigins: (process.env.WORKBENCH_DSH_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)});
  console.log(`Workbench DSH bridge: ${http.url}`);
  console.log(`Backend token file: ${auth.path}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) {
  console.error(JSON.stringify(publicError(error))); await close(); process.exitCode = 1;
}
