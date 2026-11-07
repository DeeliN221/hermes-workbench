import {createHash} from 'node:crypto';
import {isAbsolute, resolve} from 'node:path';
import {RuntimeError, nonempty} from './errors.mjs';
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const reject = message => { throw new RuntimeError(422, 'runtime/invalid-context', message); };
export function normalizeContext(input, cwd) {
  if (input === undefined) return undefined;
  const forbidden = new Set(['__jsExpr','__proto__','prototype','constructor']);
  function inspect(value) {
    if (Array.isArray(value)) { for (const item of value) inspect(item); }
    else if (object(value)) for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key)) reject('Executable expression markers and reserved keys are forbidden');
      inspect(item);
    }
  }
  inspect(input);
  if (!object(input)) reject('runtime_context must be an object');
  if (Object.keys(input).some(k => !['memory', 'skills', 'mcpServers', 'workspace'].includes(k))) reject('Unknown runtime_context field');
  const workspace = input.workspace ?? cwd;
  if (typeof workspace !== 'string' || !isAbsolute(workspace) || resolve(workspace) !== resolve(cwd)) reject('Context workspace must equal Session cwd');
  const memory = input.memory ?? {}; if (!object(memory) || Object.keys(memory).length > 30) reject('Invalid memory map');
  for (const [name, text] of Object.entries(memory)) {
    if (!/^[A-Za-z0-9_.-]{1,100}\.md$/.test(name) || typeof text !== 'string' || text.length > 200000) reject('Invalid memory section');
  }
  const skills = input.skills ?? []; if (!Array.isArray(skills) || skills.length > 50) reject('Invalid selected skills');
  const names = new Set();
  for (const skill of skills) {
    if (!object(skill) || Object.keys(skill).some(k => !['name','root','content','version'].includes(k))
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || names.has(skill.name)
      || typeof skill.content !== 'string' || skill.content.length > 200000
      || (skill.root !== undefined && (typeof skill.root !== 'string' || !isAbsolute(skill.root)))
      || (skill.version !== undefined && typeof skill.version !== 'string')) reject('Invalid selected skill');
    names.add(skill.name);
  }
  const mcpServers = input.mcpServers ?? {}; if (!object(mcpServers) || Object.keys(mcpServers).length > 16) reject('Invalid MCP server map');
  const map = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || !object(server)) reject('Invalid MCP server');
    if (Object.keys(server).some(k => !['command','args','env','url','headers','transport','enabled'].includes(k))) reject('Unknown MCP server field');
    if (server.enabled === false) continue;
    if (server.enabled !== undefined && typeof server.enabled !== 'boolean') reject('Invalid MCP enabled flag');
    if (server.transport === 'sse') reject('Legacy MCP sse transport is unsupported; use http');
    if (!['stdio','http','streamable-http'].includes(server.transport)) reject('Unsupported MCP transport');
    const strings = v => object(v) && Object.entries(v).every(([k,x]) => k && typeof x === 'string');
    if (server.transport === 'stdio') {
      if (typeof server.command !== 'string' || !server.command.trim()
        || (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(x => typeof x !== 'string')))
        || (server.env !== undefined && !strings(server.env)) || server.url || server.headers) reject('Invalid stdio MCP configuration');
      map[name] = {transport: 'stdio', command: server.command, args: server.args ?? [], env: server.env ?? {}};
    } else {
      let url; try { url = new URL(server.url); } catch { reject('Invalid MCP HTTP URL'); }
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password
        || (server.headers !== undefined && !strings(server.headers)) || server.command || server.args || server.env) reject('Invalid HTTP MCP configuration');
      map[name] = {transport: 'streamable-http', url: url.href, headers: server.headers ?? {}};
    }
  }
  const value = {workspace: resolve(workspace), memory, skills, mcpServers: map};
  if (JSON.stringify(value).length > 2 * 1024 * 1024) reject('Runtime context is too large');
  return value;
}
export function contextIdentity({user_id, profile_id, project_id, runtime_context, agent_preset = 'standard'}) {
  nonempty(user_id, 'user_id', 200);
  if (!['standard','minimal'].includes(agent_preset)) reject('Only trusted standard and minimal base presets are supported');
  return 'workbench-' + createHash('sha256').update(JSON.stringify({user_id,profile_id,project_id,runtime_context,agent_preset})).digest('hex');
}
