import { describe, expect, it } from 'vitest';

import {
  collectAttachmentDrop,
  folderBatchFromFileList,
  folderTotalBytes,
  isAttachmentDrag,
} from '../dashboard/src/workbench-attachment-drop';

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail?: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: Entry[]) => void, fail?: (error: DOMException) => void) => void };
};

function fileEntry(name: string, file: File): Entry {
  return { isFile: true, isDirectory: false, name, file: ok => ok(file) };
}

function directoryEntry(name: string, children: Entry[], chunks = 1): Entry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: ok => {
          if (offset >= chunks) return ok([]);
          offset += 1;
          ok(children);
        },
      };
    },
  };
}

function transfer(items: Array<{ entry?: Entry | null; file: File | null }>, files: File[] = []): DataTransfer {
  return {
    types: ['Files'],
    items: items.map(item => ({
      kind: 'file',
      type: item.file?.type || '',
      getAsFile: () => item.file,
      webkitGetAsEntry: () => item.entry ?? null,
    })),
    files,
  } as unknown as DataTransfer;
}

describe('Workbench attachment drag and drop', () => {
  it('recognizes only file drags', () => {
    expect(isAttachmentDrag({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(isAttachmentDrag({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
    expect(isAttachmentDrag(null)).toBe(false);
  });

  it('walks nested folders and preserves relative paths', async () => {
    const main = new File(['print(1)'], 'main.py', { type: 'text/x-python' });
    const readme = new File(['# Read'], 'readme.md', { type: 'text/markdown' });
    const folder = directoryEntry('project', [
      fileEntry('main.py', main),
      directoryEntry('docs', [fileEntry('readme.md', readme)]),
    ]);

    const batches = await collectAttachmentDrop(transfer([{ entry: folder, file: null }]));

    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.kind).toBe('folder');
    if (batch.kind !== 'folder') throw new Error('expected folder batch');
    expect(batch.name).toBe('project');
    expect(batch.entries.map(entry => entry.relativePath)).toEqual(['main.py', 'docs/readme.md']);
    expect(folderTotalBytes(batch)).toBe(14);
  });

  it('reads directory listings in multiple batches', async () => {
    const first = new File(['a'], 'a.txt');
    const second = new File(['b'], 'b.txt');
    const folder = directoryEntry('many', [fileEntry('a.txt', first), fileEntry('b.txt', second)], 2);

    const [batch] = await collectAttachmentDrop(transfer([{ entry: folder, file: null }]));

    if (batch.kind !== 'folder') throw new Error('expected folder batch');
    expect(batch.entries.map(entry => entry.relativePath)).toEqual(['a.txt', 'b.txt', 'a.txt', 'b.txt']);
  });

  it('keeps loose files and folders in separate batches', async () => {
    const loose = new File(['loose'], 'notes.txt', { type: 'text/plain' });
    const inside = new File(['x'], 'x.txt');
    const folder = directoryEntry('assets', [fileEntry('x.txt', inside)]);

    const batches = await collectAttachmentDrop(transfer([
      { entry: folder, file: null },
      { entry: fileEntry('notes.txt', loose), file: loose },
    ]));

    expect(batches.map(batch => batch.kind)).toEqual(['folder', 'files']);
    expect(batches[1].entries[0].file).toBe(loose);
  });

  it('falls back to dataTransfer.files when entry access is unavailable', async () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const data = { types: ['Files'], items: [], files: [file] } as unknown as DataTransfer;

    const [batch] = await collectAttachmentDrop(data);

    expect(batch.kind).toBe('files');
    expect(batch.entries).toEqual([{ file, relativePath: 'photo.png' }]);
  });

  it('builds a folder batch from a directory picker listing', () => {
    const files = [
      new File(['a'], 'a.txt'),
      new File(['b'], 'b.txt'),
    ];
    Object.defineProperty(files[0], 'webkitRelativePath', { value: 'project/a.txt' });
    Object.defineProperty(files[1], 'webkitRelativePath', { value: 'project/sub/b.txt' });

    const batch = folderBatchFromFileList(files);

    expect(batch?.kind).toBe('folder');
    if (!batch || batch.kind !== 'folder') throw new Error('expected folder batch');
    expect(batch.name).toBe('project');
    expect(batch.entries.map(entry => entry.relativePath)).toEqual(['a.txt', 'sub/b.txt']);
  });
});
