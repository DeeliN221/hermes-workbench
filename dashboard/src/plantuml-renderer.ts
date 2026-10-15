import { uiText } from './ui-locale';

type PlantUMLAPI = { renderToString: (lines: string[], success: (svg: string) => void, failure: (error: string) => void, options?: { dark: boolean }) => void };
const RUNTIME_URL = '/dashboard-plugins/workbench/dist/plantuml/runtime.js';
let runtimeLoad: Promise<PlantUMLAPI> | undefined;
// The upstream engine keeps only one pending request. Serialize all surfaces.
let queue: Promise<unknown> = Promise.resolve();
const pending = new WeakMap<HTMLElement, Promise<void>>();

export function isPlantUMLLanguage(language: string): boolean {
  return /^(?:plantuml|puml|uml)$/.test(language.toLowerCase());
}

function loadRuntime(): Promise<PlantUMLAPI> {
  const loaded = (window as unknown as { workbenchPlantUML?: PlantUMLAPI }).workbenchPlantUML;
  if (loaded) return Promise.resolve(loaded);
  if (runtimeLoad) return runtimeLoad;
  runtimeLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = RUNTIME_URL;
    script.addEventListener('load', () => {
      const api = (window as unknown as { workbenchPlantUML?: PlantUMLAPI }).workbenchPlantUML;
      if (api) resolve(api);
      else reject(new Error('PlantUML runtime is unavailable'));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Could not load PlantUML runtime')), { once: true });
    document.head.append(script);
  });
  return runtimeLoad.catch(error => { runtimeLoad = undefined; throw error; });
}

export function renderPlantUML(source: string, dark: boolean): Promise<string> {
  // The browser engine has no access to local files. Do not fetch remote includes.
  if (/^\s*!(?:include\w*|import)\b/im.test(source)) {
    return Promise.reject(new Error(uiText('本地渲染暂不支持 !include 或 !import，请将定义写在图表内。', 'Local rendering does not support !include or !import. Inline the definitions.')));
  }
  if (source.length > 100_000) return Promise.reject(new Error(uiText('图表源码超过 100,000 字符。', 'Diagram source exceeds 100,000 characters.')));
  const result = queue.then(async () => {
    const api = await loadRuntime();
    return new Promise<string>((resolve, reject) => {
      api.renderToString(source.split(/\r\n|\r|\n/), resolve, error => reject(new Error(error)), { dark });
    });
  });
  queue = result.catch(() => undefined);
  return result;
}

function darkTheme(): boolean {
  const preference = document.documentElement.getAttribute('data-workbench-theme');
  if (preference === 'dark' || preference === 'light') return preference === 'dark';
  return document.documentElement.classList.contains('dark')
    || /dark/i.test(document.documentElement.getAttribute('data-theme') || '');
}

function makeHost(source: string): HTMLElement {
  const host = document.createElement('section');
  host.className = 'hti-rich-plantuml hti-rich-mermaid';
  host.dataset.plantumlSource = source;
  host.setAttribute('aria-label', uiText('PlantUML 图表', 'PlantUML diagram'));
  const header = document.createElement('div');
  header.className = 'hti-rich-mermaid-header';
  const label = document.createElement('span');
  label.textContent = 'PlantUML';
  const controls = document.createElement('div');
  controls.className = 'hti-rich-mermaid-controls';
  const details = document.createElement('details');
  details.className = 'hti-rich-mermaid-source';
  const summary = document.createElement('summary');
  summary.textContent = uiText('查看源码', 'View source');
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  details.append(summary, pre);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'hti-rich-code-copy';
  copy.textContent = uiText('复制', 'Copy');
  copy.setAttribute('aria-label', uiText('复制 PlantUML 源码', 'Copy PlantUML source'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source);
      copy.textContent = uiText('已复制', 'Copied');
    } catch { copy.textContent = uiText('复制失败', 'Copy failed'); }
  });
  controls.append(details, copy);
  header.append(label, controls);
  const output = document.createElement('div');
  output.className = 'hti-rich-mermaid-svg';
  host.append(header, output);
  return host;
}

async function renderHost(host: HTMLElement, isCurrent: () => boolean): Promise<boolean> {
  const previous = pending.get(host);
  if (previous) {
    await previous;
    if (!isCurrent()) return false;
    if (host.dataset.plantumlTheme === (darkTheme() ? 'dark' : 'light')) return false;
  }
  let finish!: () => void;
  pending.set(host, new Promise<void>(resolve => { finish = resolve; }));
  const output = host.querySelector<HTMLElement>('.hti-rich-mermaid-svg')!;
  const dark = darkTheme();
  const theme = dark ? 'dark' : 'light';
  try {
    output.textContent = uiText('正在绘制 PlantUML 图表…', 'Rendering PlantUML diagram…');
    const svg = await renderPlantUML(host.dataset.plantumlSource || '', dark);
    if (!isCurrent()) return false;
    // An SVG image cannot execute scripts or load external subresources.
    const image = document.createElement('img');
    image.alt = uiText('PlantUML 图表', 'PlantUML diagram');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
    output.replaceChildren(image);
    host.dataset.plantumlTheme = theme;
    host.classList.remove('hti-rich-mermaid-error');
    host.querySelector('.hti-rich-mermaid-error-note')?.remove();
    return true;
  } catch (error) {
    if (isCurrent()) {
      host.classList.add('hti-rich-mermaid-error');
      host.querySelector('.hti-rich-mermaid-error-note')?.remove();
      const note = document.createElement('small');
      note.className = 'hti-rich-mermaid-error-note';
      note.textContent = uiText('PlantUML 渲染失败：', 'PlantUML rendering failed: ')
        + (error instanceof Error ? error.message : String(error));
      host.append(note);
      host.querySelector('details')?.setAttribute('open', '');
      host.dataset.plantumlTheme = theme;
    }
    return false;
  } finally { pending.delete(host); finish(); }
}

/** Render closed fences only when called by streaming chat; previews accept all parsed fences. */
export async function renderPlantUMLBlocks(root: HTMLElement, isCurrent = () => true, acceptSource = (_source: string) => true): Promise<number> {
  const hosts = Array.from(root.querySelectorAll<HTMLElement>('.hti-rich-plantuml[data-plantuml-source]'));
  for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
    const language = Array.from(code.classList).find(name => /^(language|lang)-/.test(name))?.replace(/^(language|lang)-/, '') || '';
    if (!isPlantUMLLanguage(language) || !acceptSource(code.textContent || '') || !isCurrent()) continue;
    const host = makeHost(code.textContent || '');
    code.parentElement?.replaceWith(host);
    hosts.push(host);
  }
  let rendered = 0;
  const theme = darkTheme() ? 'dark' : 'light';
  for (const host of hosts) {
    if (!isCurrent()) break;
    if (host.dataset.plantumlTheme === theme) continue;
    if (await renderHost(host, isCurrent)) rendered++;
  }
  return rendered;
}
