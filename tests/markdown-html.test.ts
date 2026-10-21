// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileMarkdownHtml } from '../dashboard/src/markdown-html';
import { renderPlantUMLBlocks } from '../dashboard/src/plantuml-renderer';

afterEach(() => {
  document.body.replaceChildren();
  delete (window as any).workbenchPlantUML;
  vi.restoreAllMocks();
});

describe('Markdown snapshot reconciliation', () => {
  it('restores a fenced block that was truncated by a streaming update', async () => {
    const partial = '# ADR\n\n```plantuml\n@startuml\ndatabase "独立 schema';
    const complete = '# ADR\n\n```plantuml\n@startuml\ndatabase "独立 schema / DB" as TenantDB\n@enduml\n```\n';
    const root = document.createElement('div');
    root.innerHTML = '<code class="language-plantuml">@startuml</code>';
    const rendered = { current: partial };

    expect(reconcileMarkdownHtml(root, complete, rendered)).toBe(true);
    expect(root.querySelector('code.language-plantuml')?.textContent).toContain('TenantDB');
    expect(reconcileMarkdownHtml(root, complete, rendered)).toBe(false);

    (window as any).workbenchPlantUML = {
      renderToString: (_lines: string[], success: (svg: string) => void) => success('<svg/>'),
    };
    expect(await renderPlantUMLBlocks(root)).toBe(1);
    expect(root.querySelector('.hti-rich-plantuml img')).not.toBeNull();
  });
});
