import { uiText } from './ui-locale';

/** Public PlantUML Server used when an instance has no renderer override. */
export const DEFAULT_PLANTUML_RENDER_ENDPOINT = 'https://www.plantuml.com/plantuml/svg';

type WorkbenchRuntimeConfig = { plantumlEndpoint?: unknown };
type DashboardConfig = { dashboard?: { workbench?: { plantuml_endpoint?: unknown } } };

let configuredEndpoint: string | undefined;
let configLoad: Promise<string | undefined> | undefined;

/** Drop the cached instance endpoint after a settings change. */
export function clearPlantUMLConfigCache(): void {
  configuredEndpoint = undefined;
  configLoad = undefined;
}

function normalizeEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

async function loadConfiguredEndpoint(): Promise<string | undefined> {
  const response = await fetch('/api/config', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return undefined;
  const config = await response.json() as DashboardConfig;
  return normalizeEndpoint(config.dashboard?.workbench?.plantuml_endpoint);
}

/** Resolve an instance-specific endpoint without baking private hosts into the bundle. */
export async function getPlantUMLRenderEndpoint(): Promise<string> {
  const runtime = (globalThis as typeof globalThis & { __HERMES_WORKBENCH_CONFIG__?: WorkbenchRuntimeConfig })
    .__HERMES_WORKBENCH_CONFIG__?.plantumlEndpoint;
  const runtimeEndpoint = normalizeEndpoint(runtime);
  if (runtimeEndpoint) return runtimeEndpoint;
  const build = (import.meta.env.VITE_PLANTUML_RENDER_ENDPOINT as string | undefined);
  const buildEndpoint = normalizeEndpoint(build);
  if (buildEndpoint) return buildEndpoint;
  if (configuredEndpoint) return configuredEndpoint;
  configLoad ??= loadConfiguredEndpoint().catch(() => undefined);
  const loaded = await configLoad;
  if (loaded) configuredEndpoint = loaded;
  else configLoad = undefined;
  return loaded || DEFAULT_PLANTUML_RENDER_ENDPOINT;
}

// Serialize chat and file-preview requests so the server is not overloaded.
let queue: Promise<unknown> = Promise.resolve();
const pending = new WeakMap<HTMLElement, Promise<void>>();

export function isPlantUMLLanguage(language: string): boolean {
  return /^(?:plantuml|puml|uml)$/.test(language.toLowerCase());
}

function encodePlantUML(source: string): string {
  const bytes = new TextEncoder().encode(source);
  // PlantUML's hex form keeps CJK bytes exact without client-side compression.
  // Keep the GET URL below common 8 KiB proxy and Jetty request-line limits.
  if (bytes.length > 3500) throw new Error(uiText('图表源码过长，请拆分为多幅图。', 'Diagram source is too long; split it into smaller diagrams.'));
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `~h${hex}`;
}

export function renderPlantUML(source: string, dark: boolean): Promise<string> {
  // Do not let the server fetch arbitrary remote includes from user content.
  if (/^\s*!(?:include\w*|import)\b/im.test(source)) {
    return Promise.reject(new Error(uiText('渲染暂不支持 !include 或 !import，请将定义写在图表内。', 'Rendering does not support !include or !import. Inline the definitions.')));
  }
  const result = queue.then(async () => {
    // Keep the canvas transparent in both themes after any source-level skinparam.
    const lines = source.split(/\r\n|\r|\n/).flatMap(line => /^\s*@end\w*/i.test(line)
      ? ['skinparam backgroundColor transparent', line] : [line]);
    const endpoint = await getPlantUMLRenderEndpoint();
    const encoded = encodePlantUML(lines.join('\n'));
    const response = await fetch(`${endpoint}/${encoded}`, { method: 'GET' });
    if (!response.ok) throw new Error(`PlantUML server returned HTTP ${response.status}`);
    const svg = await response.text();
    if (!/<svg\b/i.test(svg)) throw new Error('PlantUML server returned an invalid SVG');
    return svg;
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
