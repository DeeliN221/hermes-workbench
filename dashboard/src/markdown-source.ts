import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { memorySectionExtension } from './memory-markdown';
/** Raw HTML stays escaped; diagram and code enhancement run after safe parsing. */
export function renderMarkdownSource(content: string): string {
  return micromark(content, { allowDangerousHtml: false, extensions: [gfm(), memorySectionExtension], htmlExtensions: [gfmHtml()] });
}
