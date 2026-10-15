import { expect, it } from 'vitest';
import { renderMarkdownSource } from '../dashboard/src/markdown-source';
it('preserves GFM tables, tasks, footnotes and safe links through the package parser', () => {
  const html = renderMarkdownSource('| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\nA note[^1]\n\n[^1]: detail');
  expect(html).toContain('<table>');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('checked');
  expect(html).toContain('detail');
  expect(renderMarkdownSource('<script>alert(1)</script>\n\n[x](javascript:alert(1))')).not.toContain('<script>');
  expect(renderMarkdownSource('[x](javascript:alert(1))')).not.toContain('href="javascript:');
});
it('handles memory separators and incomplete fenced code without exposing HTML', () => {
  expect(renderMarkdownSource('first\n\n§\n\nsecond')).toContain('<hr />');
  expect(renderMarkdownSource('```ts\nconst value = "<script>";')).toContain('&lt;script&gt;');
});
