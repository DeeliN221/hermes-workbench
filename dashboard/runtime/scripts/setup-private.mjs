#!/usr/bin/env node
// Opt-in preparation; never prints, parses or rewrites the credential file.
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {mkdir, chmod, copyFile, readFile, writeFile, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {loadDsh} from '../dsh-peer.mjs';
if (!process.argv.includes('--use-existing-local-gateway')) throw Error('Pass --use-existing-local-gateway to opt in');
process.umask(0o077);
const state = resolve(process.env.WORKBENCH_DSH_STATE ?? join(homedir(), '.local/state/workbench-dsh-mac/runtime'));
const moduleRoot = process.env.DSH_MODULE_ROOT ?? join(state, 'install');
await loadDsh(moduleRoot);
const req = createRequire(join(moduleRoot, 'package.json'));
const yaml = req(req.resolve('js-yaml', {paths: [req.resolve('@deepseek-ai/dsh/package.json')]}));
const source = resolve(process.env.DSH_CONFIG_SOURCE ?? join(homedir(), '.dsh'));
const home = resolve(process.env.DSH_HOME ?? join(state, 'dsh-home'));
if (source === home) throw Error('Isolated DSH_HOME must differ from the source');
await mkdir(state, {recursive: true, mode: 0o700}); await chmod(state, 0o700);
await mkdir(home, {recursive: true, mode: 0o700}); await chmod(home, 0o700);
// Existing storages and credentials in this home are never replaced on rerun.
try { await stat(join(home, 'settings.yaml')); throw Error('Isolated settings already exist; use a fresh DSH_HOME'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const settings = yaml.load(await readFile(join(source, 'settings.yaml'), 'utf8'));
const provider = settings?.['llm-pi-ai']?.providers?.['magpie-responses'];
if (provider?.baseURL !== 'http://127.0.0.1:3425/v1' || provider?.apiKeyEnv !== 'MAGPIE_GATEWAY_KEY')
  throw Error('Existing configured gateway does not match the authorized local endpoint/credential pairing');
const model = provider.models?.find(m => m.id === 'codex/gpt-6.1-sol');
if (!model) throw Error('Existing configured model is unavailable');
// Only this explicit route and model are copied. No discovery or alternate endpoints.
await writeFile(join(home, 'settings.yaml'), yaml.dump({'llm-pi-ai': {providers: {'magpie-responses': {
  ...provider, models: [model], retryPolicy: {mode: 'normal', maxRetries: 0},
}}}}), {mode: 0o600, flag: 'wx'});
await copyFile(join(source, '.env'), join(home, '.env'), 1); await chmod(join(home, '.env'), 0o600);
console.log('Private DSH home prepared for the existing local gateway');
