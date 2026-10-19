// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFilePreview, renderMermaidBlocks } from '../dashboard/src/file-preview';
import { installFilesPreview } from '../dashboard/src/files-preview';

describe('Files preview browser interaction', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getElementById('hti-file-preview')?.remove();
    delete (window as any).__HERMES_WORKBENCH_FILES_PREVIEW__;
    delete (window as any).__HERMES_PLUGIN_SDK__;
    delete (window as any).mermaid;
    window.history.replaceState(null, '', '/');
  });

  it('previews a Chinese-localized filename click and downloads only from the explicit action', async () => {
    window.history.replaceState(null, '', '/files');
    document.body.innerHTML = `
      <button aria-label="上传文件"><span title="/opt/data/workspace/startup">target</span></button>
      <div class="grid">
        <button id="filename" type="button"><svg></svg><span class="truncate">README.md</span></button>
        <span>9 B</span><span>now</span>
        <span><button id="download" type="button" aria-label="Download README.md">download</button></span>
      </div>`;

    (window as any).__HERMES_PLUGIN_SDK__ = {
      authedFetch: vi.fn(async (url: string) => {
        expect(url).toBe('/api/files/read?path=%2Fopt%2Fdata%2Fworkspace%2Fstartup%2FREADME.md');
        return new Response(JSON.stringify({
          name: 'README.md',
          mime_type: 'text/markdown',
          data_url: 'data:text/markdown;base64,IyBQcmV2aWV3',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    };

    let implicitDownloads = 0;
    let explicitDownloads = 0;
    const filename = document.getElementById('filename') as HTMLButtonElement;
    const download = document.getElementById('download') as HTMLButtonElement;
    filename.addEventListener('click', () => { implicitDownloads += 1; });
    download.addEventListener('click', () => { explicitDownloads += 1; });

    installFilesPreview();
    filename.click();

    expect(implicitDownloads).toBe(0);
    await vi.waitFor(() => {
      expect(document.querySelector('#hti-file-preview h1')?.textContent).toBe('Preview');
    });

    download.click();
    expect(explicitDownloads).toBe(1);
    expect(implicitDownloads).toBe(0);
  });

  it('uses Mermaid render without a detached container argument', async () => {
    const render = vi.fn(async () => ({ svg: '<svg aria-label="diagram"></svg>' }));
    (window as any).mermaid = { initialize: vi.fn(), render };
    const root = document.createElement('div');
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    code.textContent = 'graph LR\nA-->B';
    pre.appendChild(code);
    root.appendChild(pre);

    expect(await renderMermaidBlocks(root)).toBe(1);
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^hti-mermaid-/), 'graph LR\nA-->B');
    expect(root.querySelector('.hti-mermaid svg')).not.toBeNull();
  });

  it('enables Markdown editing only after the workspace write check succeeds', async () => {
    window.history.replaceState(null, '', '/files');
    const calls: Array<{ url: string; method: string }> = [];
    (window as any).__HERMES_PLUGIN_SDK__ = {
      authedFetch: vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method || 'GET' });
        if (init?.method === 'PUT') return new Response(JSON.stringify({ version: 'v2' }), { status: 200 });
        return new Response(JSON.stringify({ content: '# Editable', version: 'v1' }), { status: 200 });
      }),
    };
    await openFilePreview('notes.md', new Blob(['# Preview'], { type: 'text/markdown' }), 'text/markdown', undefined, '/opt/data/workspace/notes.md');
    const edit = document.querySelector<HTMLButtonElement>('.hti-file-preview-edit')!;
    await vi.waitFor(() => expect(edit.title).toBe('Edit file'));
    edit.click();
    expect(document.querySelector<HTMLTextAreaElement>('.hti-file-editor')?.value).toBe('# Editable');
    const editor = document.querySelector<HTMLTextAreaElement>('.hti-file-editor')!;
    editor.value = '# Changed';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.hti-file-editor-actions .is-primary')!.click();
    await vi.waitFor(() => expect(calls.some(call => call.method === 'PUT')).toBe(true));
    expect(calls[0].url).toContain('/api/plugins/workbench/file?path=%2Fopt%2Fdata%2Fworkspace%2Fnotes.md');
  });

  it('keeps the pencil visible but disabled when the workspace denies writes', async () => {
    (window as any).__HERMES_PLUGIN_SDK__ = {
      authedFetch: vi.fn(async () => new Response(JSON.stringify({ detail: 'File is not writable' }), { status: 403 })),
    };
    await openFilePreview('readonly.md', new Blob(['# Read only'], { type: 'text/markdown' }), 'text/markdown', undefined, '/opt/data/workspace/readonly.md');
    const edit = document.querySelector<HTMLButtonElement>('.hti-file-preview-edit')!;
    await vi.waitFor(() => expect(edit.title).toContain('Write permission denied'));
    expect(edit.title).toContain('Write permission denied');
  });
});
