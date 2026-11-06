#!/usr/bin/env node
// Opt-in preparation; extracts only the explicitly configured local gateway key.
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {mkdir, chmod, readFile, writeFile, readdir, realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {copyGatewayEnvironment, GATEWAY_REFERENCE} from '../private-gateway-env.mjs';
import {loadDsh} from '../dsh-peer.mjs';
async function main() {
if (!process.argv.includes('--use-existing-local-gateway')) throw Error('Pass --use-existing-local-gateway to opt in');
process.umask(0o077);
const state = resolve(process.env.WORKBENCH_DSH_STATE ?? join(homedir(), '.local/state/workbench-dsh-mac/runtime'));
let modules;
if(process.env.DSH_MODULE_ROOT)modules=await loadDsh(process.env.DSH_MODULE_ROOT);
else {try {modules=await loadDsh();}catch(error){
  if(!['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error.code))throw error;
  modules=await loadDsh(join(state,'install'));
}}
const req=createRequire(modules.cli);
const yaml=req('js-yaml');
const source = resolve(process.env.DSH_CONFIG_SOURCE ?? join(homedir(), '.dsh'));
const home = resolve(process.env.DSH_HOME ?? join(state, 'dsh-home'));
if (source === home || home===resolve(homedir(),'.dsh')) throw Error('Use a fresh isolated DSH_HOME');
await mkdir(state, {recursive: true, mode: 0o700}); await chmod(state, 0o700);
await mkdir(home, {recursive: true, mode: 0o700});
const physicalHome=await realpath(home), originalHome=await realpath(join(homedir(),'.dsh')).catch(()=>resolve(homedir(),'.dsh'));
if(physicalHome===originalHome||physicalHome.startsWith(originalHome+'/')||physicalHome===await realpath(source))throw Error('Use a fresh isolated DSH_HOME');
await chmod(home, 0o700);
// Existing storages and credentials in this home are never replaced on rerun.
if((await readdir(home)).length)throw Error('Use a fresh empty isolated DSH_HOME');
const settings = yaml.load(await readFile(join(source, 'settings.yaml'), 'utf8'));
const provider = settings?.['llm-pi-ai']?.providers?.['magpie-responses'];
let endpoint;try {endpoint=new URL(provider?.baseURL);}catch {throw Error('Existing local gateway route is invalid');}
if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash
  ||provider?.apiKeyEnv!==GATEWAY_REFERENCE)throw Error('Existing configured gateway must use the explicit local credential pairing');
const model = provider.models?.find(m => m.id === 'codex/gpt-6.1-sol');
if (!model) throw Error('Existing configured model is unavailable');
// Only this explicit route and model are copied. No discovery or alternate endpoints.
await writeFile(join(home, 'settings.yaml'), yaml.dump({'llm-pi-ai': {providers: {'magpie-responses': {
  ...provider, models: [model], retryPolicy: {mode: 'normal', maxRetries: 0},
}}}}), {mode: 0o600, flag: 'wx'});
await copyGatewayEnvironment(join(source,'.env'),join(home,'.env'),provider.apiKeyEnv);
console.log('Private DSH home prepared for the existing local gateway');

}
main().catch(()=>{console.error('Private gateway setup failed; verify the explicit local route, credential reference and fresh isolated destination.');process.exitCode=1;});
