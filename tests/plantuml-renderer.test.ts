// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filePreviewKind } from '../dashboard/src/file-preview';
import { isPlantUMLLanguage, renderPlantUML, renderPlantUMLBlocks } from '../dashboard/src/plantuml-renderer';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.className = '';
  delete (window as any).workbenchPlantUML;
  vi.restoreAllMocks();
});

describe('PlantUML local rendering', () => {
  it('recognizes fence aliases and standalone diagram files', () => {
    for (const language of ['plantuml', 'puml', 'uml', 'PlantUML']) expect(isPlantUMLLanguage(language)).toBe(true);
    expect(isPlantUMLLanguage('mermaid')).toBe(false);
    for (const file of ['中文.PUML', 'example.plantuml', 'diagram.uml']) expect(filePreviewKind(file)).toBe('plantuml');
  });

  it('rejects remote includes and oversized source without loading an engine or sending diagram text', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderPlantUML('@startuml\n!include https://example.com/private\n@enduml', false)).rejects.toThrow('!include');
    await expect(renderPlantUML(`@startuml\n${'中'.repeat(100_001)}\n@enduml`, false)).rejects.toThrow('100,000');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="plantuml"]')).toBeNull();
  });

  it('serializes rendering, waits for a closed chat fence and preserves source on errors', async () => {
    let active = 0, maxActive = 0;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const renderToString = vi.fn((lines: string[], success: (svg: string) => void, failure: (error: string) => void, _options?: { dark: boolean }) => {
      active++; maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active--;
        if (lines.includes('invalid')) failure('Syntax error');
        else success('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>中文</text></svg>');
      }, 5);
    });
    (window as any).workbenchPlantUML = { renderToString };
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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(root.querySelector('.hti-rich-mermaid-error')?.textContent).toContain('Syntax error');
    expect(root.querySelector('.hti-rich-mermaid-error details')?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('.hti-rich-mermaid-source code')?.textContent).toBe('@startuml\nAlice -> Bob\n@enduml');
    expect(await renderPlantUMLBlocks(root)).toBe(0);
    document.documentElement.className = 'dark';
    await renderPlantUMLBlocks(root);
    expect(renderToString.mock.calls.at(-1)?.[3]).toEqual({ dark: true });
  });
});
