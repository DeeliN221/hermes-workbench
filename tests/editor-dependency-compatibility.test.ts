// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { EditorView, lineNumbers } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';

it.each([
  ['javascript', javascript, 'const value = 1'],
  ['markdown', markdown, '**original**'],
  ['python', python, 'return True'],
] as const)(
  'opens, highlights, and edits %s using compatible CodeMirror extensions', async (_name, language, source) => {
    const parent = document.createElement('div');
    document.body.append(parent);
    let view: EditorView | undefined;
    try {
      view = new EditorView({ doc: source, parent, extensions: [
        lineNumbers(), syntaxHighlighting(defaultHighlightStyle), language(),
      ] });
      await vi.waitFor(() => {
        expect(parent.querySelector('.cm-content .cm-line span[class]')).not.toBeNull();
      });
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'edited' } });
      expect(view.state.doc.toString()).toBe('edited');
      expect(parent.querySelector('.cm-content')).not.toBeNull();
    } finally { view?.destroy(); parent.remove(); }
  },
);
