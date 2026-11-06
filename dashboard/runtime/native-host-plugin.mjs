// Fixed Host-side extension: data enters through authenticated native Connection.
// Incoming JS, plugin names and Cordis YAML are never accepted or evaluated.
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, readFile, writeFile, rename, readdir, symlink, lstat} from 'node:fs/promises';
import {normalizeContext, contextIdentity} from './context.mjs';
export const name = 'workbench-context-presets';
export const inject = ['agentPresets', 'connection'];
export async function apply(ctx, config) {
  const require = createRequire(config.cli);
  const yaml = require('js-yaml');
  const {entryListSchema} = require('@deepseek-ai/cordis-plugin-include');
  const root = join(config.home, 'workbench-contexts');
  await mkdir(root, {recursive: true, mode: 0o700});
  const registrations = new Map(); const disposers = [];
  const memoryPlugin = fileURLToPath(new URL('./native-memory-plugin.mjs', import.meta.url));
  async function register(input, persist = true) {
    const context = normalizeContext(input.runtime_context, input.runtime_context?.workspace);
    const id = contextIdentity({...input, runtime_context: context});
    if (id !== input.preset_id) throw Error('Context identity mismatch');
    if (registrations.has(id)) return registrations.get(id);
    const task = (async () => {
      const directory = join(root, id); const skillsRoot = join(directory, 'skills');
      await mkdir(skillsRoot, {recursive: true, mode: 0o700});
      for (const skill of context.skills) {
        const bundle = join(skillsRoot, skill.name); await mkdir(bundle, {recursive: true, mode: 0o700});
        let content = skill.content;
        if (content.startsWith('---\n')) {
          const end = content.indexOf('\n---', 4); if (end < 0) throw Error('Invalid skill frontmatter');
          const front = yaml.load(content.slice(4,end));
          if (front?.name !== skill.name || typeof front.description !== 'string') throw Error('Skill frontmatter must match the selected skill');
        } else content = `---\nname: ${skill.name}\ndescription: Selected profile skill ${skill.name}\n---\n${content}`;
        await writeFile(join(bundle, 'SKILL.md'), content, {mode: 0o600});
        // Auxiliary resources are limited to this explicitly selected bundle.
        if (skill.root) {
          let entries = []; try { entries = await readdir(skill.root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
          for (const entry of entries) if (entry !== 'SKILL.md') {
            try { await lstat(join(bundle, entry)); } catch (e) {
              if (e.code !== 'ENOENT') throw e;
              await symlink(join(skill.root, entry), join(bundle, entry));
            }
          }
        }
      }
      const base = await ctx.agentPresets.readDocument(input.agent_preset ?? 'standard');
      // Parse only a trusted built-in native composition with the native schema.
      const original = yaml.load(base.content, {schema: entryListSchema});
      function filter(rows) {
        return rows.filter(row => !['@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-agent-instructions',
          '@deepseek-ai/dsh-mcp-client'].includes(row.name)).map(row => row.group ? {...row, config: filter(row.config)} : row);
      }
      const plugins = filter(original);
      plugins.push({id: 'workbench-memory', name: memoryPlugin, config: {memory: context.memory}});
      plugins.push({id: 'workbench-skills', name: '@deepseek-ai/dsh-skill-filesystem', config: {
        includeDefaultRoots: false, customSkillDirs: [skillsRoot], watch: false,
      }});
      for (const [serverName, server] of Object.entries(context.mcpServers)) plugins.push({
        id: `workbench-mcp-${serverName}`, name: '@deepseek-ai/dsh-mcp-client', config: {
          ...server, serverName, ...(server.transport === 'stdio' ? {cwd: context.workspace} : {}), failOnStartupError: true,
        },
      });
      if (persist) {
        const target = join(directory, 'context.json');
        await writeFile(target + '.tmp', JSON.stringify({...input, runtime_context: context}), {mode: 0o600});
        await rename(target + '.tmp', target);
      }
      const dispose = await ctx.agentPresets.register({id, name: 'Workbench scoped profile', plugins}); disposers.push(dispose);
      return id;
    })();
    registrations.set(id, task);
    try { return await task; } catch (e) { registrations.delete(id); throw e; }
  }
  // Restored definitions exist before cold native Sessions can resume.
  for (const entry of await readdir(root)) if (/^workbench-[a-f0-9]{64}$/.test(entry)) {
    const saved = JSON.parse(await readFile(join(root, entry, 'context.json'), 'utf8'));
    await register(saved, false);
  }
  ctx.effect(() => ctx.connection.fetch.register({path: '/api/workbench/context/status', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => Response.json({status: 'ready'}),
  }));
  ctx.effect(() => ctx.connection.fetch.register({path: '/api/workbench/context', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      try {
        const input = await request.json(); const id = await register(input);
        const preset = await ctx.agentPresets.resolve(id);
        if (preset.broken) return Response.json({error: {code: 'runtime/context-activation-failed'}}, {status: 502});
        return Response.json({preset_id: id, status: 'ready'});
      } catch (e) { return Response.json({error: {code: 'runtime/context-invalid'}}, {status: e.status ?? 422}); }
    },
  }));
  ctx.effect(() => async () => { for (const dispose of disposers.reverse()) await dispose(); });
}
