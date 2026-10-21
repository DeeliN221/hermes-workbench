import { renderMarkdownSource } from './markdown-source';

type RenderedMarkdown = { current: string };

/** Keep the parsed Markdown DOM in step with the latest message snapshot.
 *
 * Streaming updates can arrive after React has already parsed an earlier
 * chunk. If that chunk ended inside a fenced block, the browser keeps the
 * truncated text even when the component receives the complete message.
 * Reconcile from the source before diagram enhancement runs.
 */
export function reconcileMarkdownHtml(
  element: HTMLElement,
  content: string,
  rendered: RenderedMarkdown,
): boolean {
  if (rendered.current === content) return false;
  rendered.current = content;
  element.innerHTML = renderMarkdownSource(content);
  return true;
}
