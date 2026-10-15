import { describe, expect, it } from 'vitest';
import { renderMarkdownHtml } from '../dashboard/src/transcript-components';

describe('Hermes memory delimiters', () => {
  it('separates adjacent entries, including CRLF and the final line', () => {
    expect(renderMarkdownHtml('first\n§\nsecond')).toBe('<p>first</p>\n<hr />\n<p>second</p>');
    expect(renderMarkdownHtml('first\r\n§\r\nsecond\r\n§')).toContain('<hr />');
  });

  it('preserves section signs in prose, inline code, and code blocks', () => {
    for (const source of ['see § 2', '§ reference', '`§`', '```text\n§\n```', '~~~\n§\n~~~', '    §']) {
      expect(renderMarkdownHtml(source)).toContain('§');
      expect(renderMarkdownHtml(source)).not.toContain('<hr');
    }
  });

  it('keeps GFM and HTML escaping', () => {
    const html = renderMarkdownHtml('~~old~~\n§\n<script>alert(1)</script>');
    expect(html).toContain('<del>old</del>');
    expect(html).toContain('<hr />');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
