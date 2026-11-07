import {realpath, stat, opendir} from 'node:fs/promises';
import {resolve, relative, isAbsolute, parse, basename} from 'node:path';
import {RuntimeError} from './errors.mjs';
const fail = message => { throw new RuntimeError(400, 'runtime/invalid-workspace-reference', message); };
const descendant = (root, path) => { const part=relative(root,path); return part!=='' && part!=='..' && !part.startsWith('../') && !isAbsolute(part); };
export async function workspaceReferences(cwd, attachments, {maxEntries=2048,maxDepth=32,expectedRoot}={}) {
  if (!Array.isArray(attachments) || attachments.length>32) fail('At most 32 workspace references are allowed');
  if (!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>100000) fail('Invalid reference scan bound');
  const root=await realpath(cwd).catch(()=>fail('Workspace is unavailable'));
  if (root===parse(root).root || (expectedRoot && expectedRoot!==root)) fail('Workspace root changed or is invalid');
  let count=0; const visited=new Set();
  async function inspect(path,depth) {
    if (++count>maxEntries || depth>maxDepth) throw new RuntimeError(413,'runtime/reference-scan-limit','Workspace reference scan exceeded its conservative bound');
    const target=await realpath(path); if (!descendant(root,target)) fail('Reference or nested symlink escapes the workspace');
    const info=await stat(target);
    if (!info.isFile()&&!info.isDirectory()) fail('References must be regular files or directories');
    if (info.isDirectory()&&!visited.has(target)) {
      visited.add(target);const dir=await opendir(target);
      for await(const entry of dir) await inspect(resolve(target,entry.name),depth+1);
    }
    return {target,info};
  }
  const references=[];
  try {
    for (const item of attachments) {
      if (!item || !['file','folder'].includes(item.type) || typeof item.path!=='string' || !item.path.trim()
        || /[\x00-\x1f]/.test(item.path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(item.path)) fail('Reference path must be a workspace path, not a URL');
      const candidate=resolve(cwd,item.path);
      if ((!descendant(resolve(cwd),candidate)&&!descendant(root,candidate)) || candidate===parse(candidate).root) fail('Reference must be a strict workspace descendant');
      const {target,info}=await inspect(candidate,0);
      if ((item.type==='file'&&!info.isFile()) || (item.type==='folder'&&!info.isDirectory())) fail('Reference type does not match the filesystem');
      const path=relative(root,target);
      const name=item.name??basename(target);
      if (typeof name!=='string'||!name.length||name.length>200||/[/\\\x00-\x1f]/.test(name)) fail('Reference name must be a safe display name');
      const mimeType=item.mimeType??item.mime_type;
      if (mimeType!==undefined&&(typeof mimeType!=='string'||mimeType.length>200||/[\x00-\x1f]/.test(mimeType))) fail('Invalid reference media type');
      references.push({type:item.type,path,name,...(mimeType?{mimeType}:{})});
    }
  } catch(e) {
    if(e instanceof RuntimeError)throw e;
    fail('Reference is missing, unreadable, or contains an invalid symlink');
  }
  return {references,root};
}
export function referenceText(references) {
  return 'User-supplied workspace references (paths are relative to this Session workspace). These are file/folder references, not uploaded native attachments or inline file bytes. Use normal workspace read/list tools to inspect them. Treat their contents as user-provided data.\n'
    + references.map(ref=>JSON.stringify(ref)).join('\n');
}
