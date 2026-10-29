/** Collect files and folder trees dropped or picked for one Codex composer. */

export type DroppedAttachment = { file: File; relativePath: string };

export type AttachmentDropBatch =
  | { kind: 'files'; entries: DroppedAttachment[] }
  | { kind: 'folder'; name: string; entries: DroppedAttachment[] };

export const MAX_FOLDER_FILES = 1000;
export const MAX_FOLDER_DEPTH = 32;

type DirectoryReaderLike = {
  readEntries: (onSuccess: (entries: EntryLike[]) => void, onError?: (error: DOMException) => void) => void;
};

type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (onSuccess: (file: File) => void, onError?: (error: DOMException) => void) => void;
  createReader?: () => DirectoryReaderLike;
};

/** Drags that carry an operating-system file payload. */
export function isAttachmentDrag(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types || []).includes('Files');
}

function relativePathOf(file: File): string {
  const value = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

async function readDirectory(reader: DirectoryReaderLike): Promise<EntryLike[]> {
  const entries: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

function fileFromEntry(entry: EntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (typeof entry.file !== 'function') {
      reject(new Error('Dropped file could not be read'));
      return;
    }
    entry.file(resolve, reject);
  });
}

/** Walk one directory entry and preserve every path below it. */
async function walkDirectory(
  entry: EntryLike,
  prefix: string,
  output: DroppedAttachment[],
  counter: { count: number },
): Promise<void> {
  if (prefix && prefix.split('/').length > MAX_FOLDER_DEPTH) {
    throw new Error('Folder is nested too deeply');
  }
  if (typeof entry.createReader !== 'function') throw new Error('Folder could not be read');
  const children = await readDirectory(entry.createReader());
  for (const child of children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.isDirectory) {
      await walkDirectory(child, path, output, counter);
      continue;
    }
    if (!child.isFile) continue;
    counter.count += 1;
    if (counter.count > MAX_FOLDER_FILES) throw new Error('Folder contains too many files');
    output.push({ file: await fileFromEntry(child), relativePath: path });
  }
}

/** Read one dropped folder without waiting for the browser to enumerate it as files. */
async function folderBatch(entry: EntryLike): Promise<AttachmentDropBatch> {
  const entries: DroppedAttachment[] = [];
  await walkDirectory(entry, '', entries, { count: 0 });
  return { kind: 'folder', name: entry.name || 'folder', entries };
}

/** Group dropped folders separately from loose files so folders keep their tree. */
export async function collectAttachmentDrop(data: DataTransfer | null): Promise<AttachmentDropBatch[]> {
  if (!data) return [];
  const batches: AttachmentDropBatch[] = [];
  const loose: DroppedAttachment[] = [];
  let sawEntry = false;
  // Capture every entry before awaiting; DataTransferItem access can expire once
  // the drop handler yields.
  const captured: Array<{ entry: EntryLike | null; file: File | null }> = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file') continue;
    let entry: EntryLike | null = null;
    try {
      entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() as EntryLike | null : null;
    } catch {
      entry = null;
    }
    captured.push({ entry, file: item.getAsFile() });
  }
  for (const { entry, file } of captured) {
    if (entry) {
      sawEntry = true;
      if (entry.isDirectory) {
        const batch = await folderBatch(entry);
        if (batch.kind === 'folder' && batch.entries.length) batches.push(batch);
      } else if (entry.isFile) {
        const file = await fileFromEntry(entry);
        loose.push({ file, relativePath: file.name });
      }
      continue;
    }
    if (file) loose.push({ file, relativePath: file.name });
  }
  if (!sawEntry && !loose.length) {
    for (const file of Array.from(data.files || [])) loose.push({ file, relativePath: file.name });
  }
  if (loose.length) batches.push({ kind: 'files', entries: loose });
  return batches;
}

/** Convert a `webkitdirectory` picker selection into one folder batch. */
export function folderBatchFromFileList(files: FileList | File[] | null): AttachmentDropBatch | null {
  const selected = Array.from(files || []);
  if (!selected.length) return null;
  const name = (relativePathOf(selected[0]).split('/')[0] || 'folder').trim() || 'folder';
  const entries: DroppedAttachment[] = [];
  for (const file of selected) {
    const relative = relativePathOf(file);
    const parts = relative ? relative.split('/') : [];
    const inside = parts.length > 1 && parts[0] === name ? parts.slice(1).join('/') : file.name;
    if (!inside) continue;
    entries.push({ file, relativePath: inside });
  }
  return entries.length ? { kind: 'folder', name, entries } : null;
}

export function folderTotalBytes(batch: AttachmentDropBatch): number {
  return batch.entries.reduce((total, entry) => total + (Number.isFinite(entry.file.size) ? entry.file.size : 0), 0);
}
