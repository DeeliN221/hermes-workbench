/** One set of CodeMirror dependencies shared by previews, workspace and skill editors. */
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { liquid } from '@codemirror/lang-liquid';
import { php } from '@codemirror/lang-php';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
export { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
export { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
export function codeLanguage(language: string) {
  switch (language) {
    case 'js': case 'mjs': case 'cjs': case 'javascript': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'typescript': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'py': case 'python': return python();
    case 'json': case 'jsonc': return json();
    case 'css': return css();
    case 'html': case 'htm': case 'xml': return html();
    case 'c': case 'h': case 'cc': case 'cpp': case 'cxx': case 'hpp': return cpp();
    case 'go': case 'golang': return go();
    case 'java': return java();
    case 'rs': case 'rust': return rust();
    case 'sql': return sql();
    case 'php': return php();
    case 'yaml': case 'yml': return yaml();
    case 'liquid': return liquid();
    default: return null;
  }
}
export function fileLanguage(path: string) {
  if (/\.(?:js|jsx|mjs|cjs|ts|tsx)$/i.test(path)) return [javascript({ typescript: /\.(?:ts|tsx)$/i.test(path), jsx: /\.(?:jsx|tsx)$/i.test(path) })];
  if (/\.py$/i.test(path)) return [python()];
  if (/\.jsonc?$/i.test(path)) return [json()];
  if (/\.css$/i.test(path)) return [css()];
  if (/\.(?:html?|vue|svelte)$/i.test(path)) return [html()];
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const language = codeLanguage(extension);
  if (language) return [language];
  if (/\.(?:md|markdown|mdown|mdx)$/i.test(path)) return [markdown()];
  return [];
}
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.docComment], color: 'var(--hti-code-comment)' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--hti-code-keyword)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.arithmeticOperator, tags.logicOperator], color: 'var(--hti-code-operator)' },
  { tag: [tags.string, tags.docString, tags.character, tags.attributeValue], color: 'var(--hti-code-string)' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.atom, tags.null], color: 'var(--hti-code-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--hti-code-type)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--hti-code-variable)' },
  { tag: [tags.definitionOperator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--hti-code-punctuation)' },
  { tag: tags.invalid, color: 'var(--hti-code-invalid)' },
]);
