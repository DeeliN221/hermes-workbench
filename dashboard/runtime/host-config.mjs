import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {RuntimeError} from './errors.mjs';
export async function installHostExtension(home, modules) {
  home = resolve(home);
  if (home === join(homedir(), '.dsh')) throw new RuntimeError(503, 'runtime/isolated-home-required', 'Use a private isolated DSH_HOME');
  const require = createRequire(modules.cli);
  const yaml = require('js-yaml'); const {entryListSchema} = require('@deepseek-ai/cordis-plugin-include');
  const profile = join(home, 'profiles', 'web'); await mkdir(profile, {recursive: true, mode: 0o700});
  const path = join(profile, 'cordis.patch.yml');
  let patch = [];
  try { patch = yaml.load(await readFile(path, 'utf8'), {schema: entryListSchema}) ?? []; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!Array.isArray(patch)) throw new RuntimeError(503, 'runtime/invalid-profile', 'Isolated profile patch must be a list');
  const row = {id: 'workbench-context-presets', name: fileURLToPath(new URL('./native-host-plugin.mjs', import.meta.url)),
    config: {home, cli: modules.cli}};
  let replaced = false;
  for (const operation of patch) if (operation.insert) {
    const rows = Array.isArray(operation.insert) ? operation.insert : [operation.insert];
    for (let i = 0; i < rows.length; i++) if (rows[i].id === row.id) { rows[i] = row; replaced = true; }
    operation.insert = rows;
  }
  if (!replaced) patch.push({insert: [row]});
  await writeFile(path + '.tmp', yaml.dump(patch, {schema: entryListSchema, noRefs: true, lineWidth: -1}), {mode: 0o600});
  await rename(path + '.tmp', path);
}
