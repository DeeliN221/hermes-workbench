import { renderPlantUMLBlocks } from './plantuml-renderer';
import { memorySectionExtension } from './memory-markdown';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { uiText } from './ui-locale';

type PreviewKind = 'markdown' | 'image' | 'pdf' | 'text' | 'download' | 'plantuml';
type EditableDocument = { path: string; content: string; version: string };
type MermaidAPI = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, definition: string, container?: Element) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

const MERMAID_SCRIPT_ID = 'hti-mermaid-runtime';
const MERMAID_SCRIPT_URL = '/dashboard-plugins/workbench/dist/mermaid.min.js';
let mermaidLoad: Promise<MermaidAPI> | undefined;
let previewObjectUrls: string[] = [];
let mermaidSequence = 0;
const previewHistory: { overlay: HTMLElement; urls: string[]; scrollTop: number; focus: HTMLElement | null }[] = [];

function removeCurrentPreview(): void {
  document.getElementById('hti-file-preview')?.remove();
  for (const url of previewObjectUrls) URL.revokeObjectURL(url);
  previewObjectUrls = [];
}

function backFilePreview(): void {
  const previous = previewHistory.pop();
  if (!previous) return;
  removeCurrentPreview();
  previewObjectUrls = previous.urls;
  document.body.append(previous.overlay);
  previous.focus?.focus({ preventScroll: true });
  const body = previous.overlay.querySelector<HTMLElement>('.hti-file-preview-body');
  if (body) body.scrollTop = previous.scrollTop;
}

/** Shared policy for Kanban attachments and the native Files page. */
export function filePreviewKind(filename: string, contentType = ''): PreviewKind {
  const lower = filename.toLowerCase();
  if (/\.(?:puml|plantuml|uml)$/.test(lower)) return 'plantuml';
  if (/\.(?:md|markdown|mdown|mdx)$/.test(lower) || contentType.includes('markdown')) return 'markdown';
  if (/\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/.test(lower) || contentType.startsWith('image/')) return 'image';
  if (lower.endsWith('.pdf') || contentType === 'application/pdf') return 'pdf';
  if (/\.(?:txt|log|csv|json|ya?ml|toml|ini|cfg|conf|xml|py|ts|tsx|js|jsx|sh|bash|css|html?|sql|c|cc|cpp|h|hpp|rs|go|java)$/.test(lower) || contentType.startsWith('text/')) return 'text';
  return 'download';
}

export function closeFilePreview(): void {
  removeCurrentPreview();
  for (const previous of previewHistory.splice(0)) {
    for (const url of previous.urls) URL.revokeObjectURL(url);
  }
}

function objectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  previewObjectUrls.push(url);
  return url;
}

function mermaidGlobal(): MermaidAPI | undefined {
  return (window as unknown as { mermaid?: MermaidAPI }).mermaid;
}

function loadMermaid(): Promise<MermaidAPI> {
  const loaded = mermaidGlobal();
  if (loaded) return Promise.resolve(loaded);
  if (mermaidLoad) return mermaidLoad;
  mermaidLoad = new Promise<MermaidAPI>((resolve, reject) => {
    const existing = document.getElementById(MERMAID_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    const finish = () => {
      const api = mermaidGlobal();
      if (api) resolve(api);
      else reject(new Error(uiText('Mermaid 运行时未注册', 'Mermaid runtime is unavailable')));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error(uiText('Mermaid 运行时加载失败', 'Could not load Mermaid runtime'))), { once: true });
    if (!existing) {
      script.id = MERMAID_SCRIPT_ID;
      script.src = MERMAID_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch(error => {
    mermaidLoad = undefined;
    throw error;
  });
  return mermaidLoad;
}

/** Render fenced ```mermaid blocks after safe Markdown conversion. */
export async function renderMermaidBlocks(root: HTMLElement): Promise<number> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));
  if (!blocks.length) return 0;
  const mermaid = await loadMermaid();
  const dark = document.documentElement.classList.contains('dark')
    || document.documentElement.getAttribute('data-theme')?.includes('dark');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    layout: 'dagre',
    look: 'classic',
    theme: dark ? 'dark' : 'default',
  });
  let rendered = 0;
  for (const code of blocks) {
    const source = code.textContent || '';
    const host = document.createElement('div');
    host.className = 'hti-mermaid';
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', uiText('Mermaid 图表', 'Mermaid diagram'));
    try {
      const result = await mermaid.render(`hti-mermaid-${Date.now()}-${mermaidSequence++}`, source);
      host.innerHTML = result.svg;
      result.bindFunctions?.(host);
      code.parentElement?.replaceWith(host);
      rendered += 1;
    } catch (error) {
      code.parentElement?.classList.add('hti-mermaid-error');
      const note = document.createElement('small');
      note.className = 'hti-mermaid-error-note';
      note.textContent = uiText(
        `Mermaid 渲染失败：${error instanceof Error ? error.message : String(error)}`,
        `Mermaid rendering failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      code.parentElement?.appendChild(note);
    }
  }
  return rendered;
}

function previewActionIcon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

class FileEditError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function authenticatedFetch(url: string, init?: RequestInit): Promise<Response> {
  const sdk = (window as any).__HERMES_PLUGIN_SDK__;
  return sdk?.authedFetch
    ? sdk.authedFetch(url, init)
    : fetch(url, { credentials: 'same-origin', ...init });
}

async function readEditableFile(path: string): Promise<EditableDocument> {
  const response = await authenticatedFetch(`/api/plugins/workbench/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.clone().json();
      detail = typeof payload?.detail === 'string' ? payload.detail : payload?.detail?.message || '';
    } catch { /* The status is enough for non-JSON responses. */ }
    throw new FileEditError(response.status, detail || uiText(`文件编辑不可用（${response.status}）`, `File editing is unavailable (${response.status})`));
  }
  const payload = await response.json() as Partial<EditableDocument>;
  if (typeof payload.content !== 'string' || typeof payload.version !== 'string') {
    throw new FileEditError(500, uiText('编辑接口未返回有效内容', 'The edit API returned invalid content'));
  }
  return { path, content: payload.content, version: payload.version };
}

async function saveEditableFile(document: EditableDocument, content: string): Promise<EditableDocument> {
  const response = await authenticatedFetch(`/api/plugins/workbench/file?path=${encodeURIComponent(document.path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, version: document.version }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.clone().json();
      detail = typeof payload?.detail === 'string' ? payload.detail : payload?.detail?.message || '';
    } catch { /* The status is enough for non-JSON responses. */ }
    throw new FileEditError(response.status, detail || uiText(`文件保存失败（${response.status}）`, `Could not save file (${response.status})`));
  }
  const payload = await response.json() as Partial<EditableDocument>;
  if (typeof payload.version !== 'string') throw new FileEditError(500, uiText('保存接口未返回版本', 'The save API returned no version'));
  return { ...document, content, version: payload.version };
}

function editUnavailableMessage(error: unknown): string {
  if (error instanceof FileEditError && error.status === 403) {
    return uiText('没有写入权限，已禁用编辑', 'Write permission denied; editing is disabled');
  }
  return uiText('此文件当前不可编辑', 'This file cannot be edited');
}

function editButton(path: string | undefined): HTMLButtonElement {
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'hti-file-preview-edit hti-file-preview-action';
  edit.disabled = true;
  edit.title = path ? uiText('正在检查编辑权限…', 'Checking edit permission…') : uiText('此来源不支持编辑', 'Editing is unavailable for this source');
  edit.setAttribute('aria-label', edit.title);
  edit.append(previewActionIcon('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z'));
  return edit;
}

function renderEditor(
  body: HTMLElement,
  header: Element | null,
  filename: string,
  documentValue: EditableDocument,
  edit: HTMLButtonElement,
): void {
  body.classList.remove('hti-rich-text');
  body.classList.add('hti-file-editor-body');
  body.replaceChildren();
  edit.disabled = true;
  edit.title = uiText('正在编辑', 'Editing');
  const textarea = document.createElement('textarea');
  textarea.className = 'hti-file-editor';
  textarea.value = documentValue.content;
  textarea.setAttribute('aria-label', uiText(`编辑 ${filename}`, `Edit ${filename}`));
  const actions = document.createElement('div');
  actions.className = 'hti-file-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = uiText('取消', 'Cancel');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'is-primary';
  save.textContent = uiText('保存', 'Save');
  const status = document.createElement('span');
  status.className = 'hti-file-editor-status';
  actions.append(status, cancel, save);
  body.append(textarea, actions);
  textarea.focus();
  cancel.addEventListener('click', () => {
    body.classList.remove('hti-file-editor-body');
    body.classList.add('hti-rich-text');
    body.replaceChildren();
    body.innerHTML = micromark(documentValue.content, {
      allowDangerousHtml: false,
      extensions: [gfm(), memorySectionExtension],
      htmlExtensions: [gfmHtml()],
    });
    void Promise.all([renderMermaidBlocks(body), renderPlantUMLBlocks(body)]);
    edit.disabled = false;
    edit.title = uiText('编辑文件', 'Edit file');
    edit.setAttribute('aria-label', edit.title);
    edit.addEventListener('click', () => renderEditor(body, header || null, filename, documentValue, edit), { once: true });
    header?.removeAttribute('data-hti-file-editing');
  });
  save.addEventListener('click', () => {
    save.disabled = true;
    cancel.disabled = true;
    status.textContent = uiText('保存中…', 'Saving…');
    void saveEditableFile(documentValue, textarea.value).then(saved => {
      documentValue = saved;
      cancel.click();
      status.textContent = uiText('已保存', 'Saved');
    }).catch(error => {
      status.textContent = error instanceof FileEditError && error.status === 409
        ? uiText('文件已在别处修改，请重新打开后再保存', 'The file changed elsewhere. Reopen it before saving.')
        : String(error);
      save.disabled = false;
      cancel.disabled = false;
    });
  });
  header?.setAttribute('data-hti-file-editing', 'true');
}

function previewShell(filename: string, navigate = false): { overlay: HTMLElement; body: HTMLElement } {
  const current = document.getElementById('hti-file-preview');
  if (navigate && current) {
    previewHistory.push({
      overlay: current,
      urls: previewObjectUrls,
      scrollTop: current.querySelector('.hti-file-preview-body')?.scrollTop || 0,
      focus: current.contains(document.activeElement) ? document.activeElement as HTMLElement : null,
    });
    current.remove();
    previewObjectUrls = [];
  } else closeFilePreview();
  const overlay = document.createElement('div');
  overlay.id = 'hti-file-preview';
  overlay.className = 'hti-file-preview';
  overlay.addEventListener('click', event => { if (event.target === overlay) closeFilePreview(); });
  const panel = document.createElement('article');
  panel.className = 'hti-file-preview-panel';
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = filename;
  title.title = filename;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'hti-file-preview-action';
  close.title = uiText('关闭预览', 'Close preview');
  close.append(previewActionIcon('M18 6 6 18M6 6l12 12'));
  close.setAttribute('aria-label', uiText('关闭预览', 'Close preview'));
  close.addEventListener('click', closeFilePreview);
  header.append(title);
  if (previewHistory.length) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'hti-file-preview-action hti-file-preview-back';
    back.title = uiText('返回上一级', 'Back to previous file');
    back.setAttribute('aria-label', back.title);
    back.append(previewActionIcon('M19 12H5m7-7-7 7 7 7'));
    back.addEventListener('click', backFilePreview);
    header.append(back);
  }
  header.append(close);
  const body = document.createElement('div');
  body.className = 'hti-file-preview-body';
  panel.append(header, body);
  overlay.append(panel);
  document.body.append(overlay);
  return { overlay, body };
}

/** Show immediate feedback while the file API is being read. */
export function showFilePreviewLoading(filename: string, navigate = false): HTMLElement {
  const { body } = previewShell(filename, navigate);
  body.textContent = uiText('正在读取文件…', 'Loading file…');
  return body;
}

/** Open a safe, theme-aware in-page preview while preserving native downloads. */
export async function openFilePreview(filename: string, blob: Blob, contentType = blob.type, existingBody?: HTMLElement, path?: string): Promise<void> {
  const kind = filePreviewKind(filename, contentType);
  const body = existingBody || previewShell(filename).body;
  body.replaceChildren();
  const header = body.closest('.hti-file-preview-panel')?.querySelector('header');
  header?.querySelector('a[download]')?.remove();
  const download = document.createElement('a');
  download.href = objectUrl(blob);
  download.download = filename;
  download.title = uiText('下载文件', 'Download file');
  download.setAttribute('aria-label', download.title);
  download.append(previewActionIcon('M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4'));
  download.className = 'hti-file-preview-download hti-file-preview-action';
  header?.insertBefore(download, header.lastElementChild);
  if (kind === 'markdown') {
    const edit = editButton(path);
    header?.insertBefore(edit, download);
    body.classList.add('hti-rich-text');
    body.innerHTML = micromark(await blob.text(), {
      allowDangerousHtml: false,
      extensions: [gfm(), memorySectionExtension],
      htmlExtensions: [gfmHtml()],
    });
    await Promise.all([renderMermaidBlocks(body), renderPlantUMLBlocks(body)]);
    if (path) {
      void readEditableFile(path).then(documentValue => {
        edit.disabled = false;
        edit.title = uiText('编辑文件', 'Edit file');
        edit.setAttribute('aria-label', edit.title);
        edit.addEventListener('click', () => renderEditor(body, header || null, filename, documentValue, edit), { once: true });
      }).catch(error => {
        edit.disabled = true;
        edit.title = editUnavailableMessage(error);
        edit.setAttribute('aria-label', edit.title);
      });
    }
  } else if (kind === 'plantuml') {
    body.classList.add('hti-rich-text');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-plantuml';
    code.textContent = await blob.text();
    pre.append(code);
    body.append(pre);
    await renderPlantUMLBlocks(body);
  } else if (kind === 'image') {
    const image = document.createElement('img');
    image.src = objectUrl(blob);
    image.alt = filename;
    body.appendChild(image);
  } else if (kind === 'pdf') {
    const frame = document.createElement('iframe');
    frame.src = objectUrl(blob);
    frame.title = filename;
    body.appendChild(frame);
  } else if (kind === 'text') {
    const pre = document.createElement('pre');
    pre.textContent = await blob.text();
    body.appendChild(pre);
  } else {
    const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
    const pre = document.createElement('pre');
    pre.textContent = Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => {
      const chunk = bytes.slice(row * 16, row * 16 + 16);
      return `${(row * 16).toString(16).padStart(8, '0')}  ${Array.from(chunk, byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${Array.from(chunk, byte => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.').join('')}`;
    }).join('\n');
    const note = document.createElement('p');
    note.textContent = uiText(
      `此格式显示二进制预览（前 ${bytes.length} 字节，共 ${blob.size} 字节）；可下载完整文件。`,
      `Binary preview (first ${bytes.length} of ${blob.size} bytes). Download for the complete file.`,
    );
    body.append(note, pre);
  }
}
