import {randomBytes, timingSafeEqual} from 'node:crypto';
import {open, lstat, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {RuntimeError} from './errors.mjs';

export async function bridgeToken(path) {
  path = resolve(path);
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(randomBytes(32).toString('base64url')); await file.sync(); }
    finally { await file.close(); }
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid()))
    throw new RuntimeError(503, 'runtime/private-file-required', 'Bridge token file must be owner-only');
  const file = await open(path, 'r'); let token;
  try { token = (await file.readFile('utf8')).trim(); } finally { await file.close(); }
  if (!/^[A-Za-z0-9._~+/-]{32,256}={0,2}$/.test(token))
    throw new RuntimeError(503, 'runtime/invalid-token-file', 'Invalid bridge token file');
  const expected = Buffer.from(`Bearer ${token}`);
  return {path, authenticate(header) {
    const actual = Buffer.from(typeof header === 'string' ? header : '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }};
}
