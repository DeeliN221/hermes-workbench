import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectGatewayEnvironment,copyGatewayEnvironment,GATEWAY_REFERENCE} from '../private-gateway-env.mjs';

test('fresh home receives exactly the matched gateway key, never unrelated provider or NAS entries',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gateway-env-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source.env');const target=join(root,'private.env');
 const input='DEEPSEEK_API_KEY=unrelated-fixture\nMAGPIE_GATEWAY_KEY="selected#fixture" # unrelated comment\nNAS_KEY=nas-fixture\nMAGPIE_GATEWAY_KEY_OTHER=wrong-fixture\n';
 await writeFile(source,input,{mode:0o600});await copyGatewayEnvironment(source,target,GATEWAY_REFERENCE);
 assert.deepEqual({...parseEnv(await readFile(target,'utf8'))},{MAGPIE_GATEWAY_KEY:'selected#fixture'});
 assert.equal((await stat(target)).mode&0o777,0o600);assert.equal(await readFile(source,'utf8'),input);
 await assert.rejects(copyGatewayEnvironment(source,target,GATEWAY_REFERENCE));
});

test('dotenv export, comments, quoted hashes, whitespace, multiline, backslashes and last assignment semantics round-trip',()=>{
 for(const input of [
  'export MAGPIE_GATEWAY_KEY = value # comment',
  "MAGPIE_GATEWAY_KEY=' hash # quoted '",
  'MAGPIE_GATEWAY_KEY="line1\\nline2"',
  "MAGPIE_GATEWAY_KEY='line1\nline2'",
  "MAGPIE_GATEWAY_KEY='literal\\n\\path'",
  'MAGPIE_GATEWAY_KEY=`single\' and double"`',
  'MAGPIE_GATEWAY_KEY=first\nMAGPIE_GATEWAY_KEY=last',
 ]) {
  const selected=selectGatewayEnvironment(input,GATEWAY_REFERENCE);
  assert.deepEqual(Object.keys(parseEnv(selected)),[GATEWAY_REFERENCE]);
  assert.equal(parseEnv(selected)[GATEWAY_REFERENCE],parseEnv(input)[GATEWAY_REFERENCE]);
 }
});

test('missing/empty or wrong credential references fail closed with no source content in errors',()=>{
 const marker='PRIVATE_FIXTURE_MUST_NOT_APPEAR';
 for(const source of [`DEEPSEEK_API_KEY=${marker}`,`OTHER_${GATEWAY_REFERENCE}=${marker}`,'MAGPIE_GATEWAY_KEY=']){
  assert.throws(()=>selectGatewayEnvironment(source,GATEWAY_REFERENCE),e=>!e.message.includes(marker)&&!e.message.includes('DEEPSEEK'));
 }
 assert.throws(()=>selectGatewayEnvironment(`DEEPSEEK_API_KEY=${marker}`,'DEEPSEEK_API_KEY'),e=>!e.message.includes(marker));
});
