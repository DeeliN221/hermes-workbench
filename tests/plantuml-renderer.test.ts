// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filePreviewKind } from '../dashboard/src/file-preview';
import { clearPlantUMLConfigCache, DEFAULT_PLANTUML_RENDER_ENDPOINT, getPlantUMLRenderEndpoint, isPlantUMLLanguage, renderPlantUML, renderPlantUMLBlocks } from '../dashboard/src/plantuml-renderer';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.className = '';
  delete (window as any).__HERMES_WORKBENCH_CONFIG__;
  clearPlantUMLConfigCache();
  vi.restoreAllMocks();
});

describe('PlantUML configurable rendering', () => {
  it('recognizes fence aliases and standalone diagram files', () => {
    for (const language of ['plantuml', 'puml', 'uml', 'PlantUML']) expect(isPlantUMLLanguage(language)).toBe(true);
    expect(isPlantUMLLanguage('mermaid')).toBe(false);
    for (const file of ['中文.PUML', 'example.plantuml', 'diagram.uml']) expect(filePreviewKind(file)).toBe('plantuml');
  });

  it('defaults to the public server and reads a configured instance endpoint', async () => {
    let config: any = { dashboard: {} };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => config }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getPlantUMLRenderEndpoint()).toBe(DEFAULT_PLANTUML_RENDER_ENDPOINT);
    expect(fetchMock).toHaveBeenCalledWith('/api/config', expect.objectContaining({ credentials: 'same-origin' }));
    clearPlantUMLConfigCache();
    config = { dashboard: { workbench: { plantuml_endpoint: 'https://configured.example.test/svg/' } } };
    expect(await getPlantUMLRenderEndpoint()).toBe('https://configured.example.test/svg');
  });

  it('allows a runtime endpoint override', async () => {
    (window as any).__HERMES_WORKBENCH_CONFIG__ = { plantumlEndpoint: 'https://nas.example.test/svg' };
    expect(await getPlantUMLRenderEndpoint()).toBe('https://nas.example.test/svg');
  });

  it('rejects remote includes before requesting the render server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderPlantUML('@startuml\n!include https://example.com/private\n@enduml', false)).rejects.toThrow('!include');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects source too large for a safe render URL', async () => {
    const source = `@startuml\n${'中'.repeat(1200)}\n@enduml`;
    await expect(renderPlantUML(source, false)).rejects.toThrow('too long');
  });

  it('serializes rendering, waits for a closed chat fence and preserves source on errors', async () => {
    let active = 0, maxActive = 0;
    let fetchCalls = 0;
    (window as any).__HERMES_WORKBENCH_CONFIG__ = { plantumlEndpoint: 'https://nas.example.test/svg' };
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      const text = fetchCalls++ === 2 ? '<error>Syntax error</error>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>中文</text></svg>';
      return { ok: true, status: 200, text: async () => text };
    });
    vi.stubGlobal('fetch', fetchMock);
    const root = document.createElement('div');
    root.innerHTML = '<pre><code class="language-plantuml">@startuml\nAlice -> Bob\n@enduml</code></pre><pre><code class="language-uml">invalid</code></pre>';
    document.body.append(root);
    expect(await renderPlantUMLBlocks(root, () => true, () => false)).toBe(0);
    expect(root.querySelectorAll('pre').length).toBe(2);
    const rendering = renderPlantUMLBlocks(root);
    const parallel = renderPlantUML('@startuml\nA -> B\n@enduml', false);
    expect(await rendering).toBe(1);
    await parallel;
    expect(maxActive).toBe(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/nas\.example\.test\/svg\/~h[0-9a-f]+$/);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(root.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(root.querySelector('.hti-rich-mermaid-error')?.textContent).toContain('invalid SVG');
    expect(root.querySelector('.hti-rich-mermaid-error details')?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('.hti-rich-mermaid-source code')?.textContent).toBe('@startuml\nAlice -> Bob\n@enduml');
    expect(await renderPlantUMLBlocks(root)).toBe(0);
  });
});
