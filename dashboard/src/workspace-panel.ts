import { uiText as sourceText } from './ui-locale';
/**
 * Provide an OZW-style workspace tree, read-only image previews, Markdown previews, and CodeMirror editing.
 * Scope every file operation to the session-bound workspace ID.
 */
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import { renderMarkdownHtml } from './transcript-components';
import { fileLanguage } from './editor-runtime';
import {
  getAssetUrl,
  isImagePath,
  isMarkdownPath,
  listFiles,
  readFile,
  writeFile,
  type FileEntry,
  type Workspace,
} from './workbench-api';

type SDK = Record<string, any>;
type CodeEditorProps = { path: string; value: string; onChange: (value: string) => void };
type WorkspacePanelProps = { workspace: Workspace | null };
type ImageLoadState = 'loading' | 'loaded' | 'error';

/** Create elements with the host React instance instead of bundling another runtime. */
function element(React: any, type: any, props?: Record<string, any> | null, ...children: any[]): any {
  return React.createElement(type, props, ...children);
}

/** Return a lightweight filename icon category without another icon package. */
function fileIcon(entry: FileEntry, expanded = false): string {
  if (entry.type === 'directory') return expanded ? '▾' : '▸';
  if (isMarkdownPath(entry.path)) return 'M';
  if (isImagePath(entry.path)) return '▧';
  return '·';
}

/** Select CodeMirror syntax support from the current file name. */
function languageForPath(path: string): any[] {
  return fileLanguage(path);
}

/** Create a controlled editor using native CodeMirror packages only. */
function createCodeEditor(sdk: SDK): (props: CodeEditorProps) => any {
  const React = sdk.React;
  const { useEffect, useRef } = sdk.hooks;

  return function CodeEditor({ path, value, onChange }: CodeEditorProps): any {
    /** Create EditorView on mount and recreate it when switching files to prevent stale document state. */
    const hostRef = useRef(null as HTMLDivElement | null);
    const changeRef = useRef(onChange);
    changeRef.current = onChange;

    useEffect(() => {
      if (!hostRef.current) return undefined;
      const view = new EditorView({
        doc: value,
        parent: hostRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...languageForPath(path),
          EditorView.lineWrapping,
          EditorView.updateListener.of(update => {
            if (update.docChanged) changeRef.current(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)' },
            '.cm-content': { minHeight: '100%', padding: '12px 4px' },
            '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      });
      return () => view.destroy();
    }, []);

    return element(React, 'div', { ref: hostRef, className: 'hti-codemirror' });
  };
}

/** Create a combined file tree and editor panel. */
export function createWorkspacePanel(sdk: SDK): (props: WorkspacePanelProps) => any {
  const React = sdk.React;
  const { useCallback, useEffect, useRef, useState } = sdk.hooks;
  const CodeEditor = createCodeEditor(sdk);

  /** Render native browser images and expose network status to the user. */
  function ImagePreview({ path }: { path: string }): any {
    const [status, setStatus] = useState('loading' as ImageLoadState);
    const assetUrl = getAssetUrl(path);
    const fileName = path.split('/').filter(Boolean).at(-1) || path;

    return element(React, 'div', {
      className: `hti-image-preview is-${status}`,
      'aria-busy': status === 'loading',
    },
      status === 'loading' ? element(React, 'div', {
        className: 'hti-image-preview-status', role: 'status',
      }, sourceText("图片加载中… / Loading image…", "Loading image…")) : null,
      status === 'error' ? element(React, 'div', {
        className: 'hti-image-preview-error', role: 'alert',
      }, sourceText("图片加载失败 / Unable to load image", "Unable to load image")) : null,
      element(React, 'img', {
        className: 'hti-image-preview-image',
        src: assetUrl,
        alt: fileName,
        hidden: status === 'error',
        onLoad: () => setStatus('loaded'),
        onError: () => setStatus('error'),
      }),
      element(React, 'a', {
        className: 'hti-image-open-original',
        href: assetUrl,
        target: '_blank',
        rel: 'noreferrer',
      }, sourceText("打开原图 / Open original", "Open original")),
    );
  }

  /** Lazily load a directory node with state scoped to the current workspace lifetime. */
  function DirectoryNode({
    entry,
    workspaceId,
    onOpen,
  }: {
    entry: FileEntry;
    workspaceId: string;
    onOpen: (entry: FileEntry) => void;
  }): any {
    const [expanded, setExpanded] = useState(false);
    const [children, setChildren] = useState([] as FileEntry[]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');

    /** Fetch immediate children on first expansion and retain the cache on collapse. */
    const toggle = async () => {
      if (expanded) {
        setExpanded(false);
        return;
      }
      setExpanded(true);
      if (children.length > 0) return;
      setLoading(true);
      setLoadError('');
      try { setChildren(await listFiles(sdk.fetchJSON, entry.path)); }
      catch (error) { setLoadError(String(error)); }
      finally { setLoading(false); }
    };

    return element(React, 'li', { className: 'hti-tree-branch' },
      element(React, 'button', {
        type: 'button', className: 'hti-tree-row is-directory', onClick: toggle,
        title: entry.path,
      },
        element(React, 'span', { className: 'hti-file-icon', 'aria-hidden': true }, fileIcon(entry, expanded)),
        element(React, 'span', null, entry.name)),
      expanded ? element(React, 'ul', { className: 'hti-tree-children' },
        loading ? element(React, 'li', { className: 'hti-tree-loading' }, sourceText("加载中… / Loading…", "Loading…")) : null,
        loadError ? element(React, 'li', { className: 'hti-tree-error', role: 'alert' }, loadError) : null,
        ...children.map((child: FileEntry) => child.type === 'directory'
          ? element(React, DirectoryNode, { key: child.path, entry: child, workspaceId, onOpen })
          : element(React, 'li', { key: child.path },
            element(React, 'button', {
              type: 'button', className: 'hti-tree-row', onClick: () => onOpen(child), title: child.path,
            },
              element(React, 'span', { className: 'hti-file-icon', 'aria-hidden': true }, fileIcon(child)),
              element(React, 'span', null, child.name))))
      ) : null);
  }

  return function WorkspacePanel({ workspace }: WorkspacePanelProps): any {
    /** Browse the workspace, open files, switch source/preview mode, and save explicitly. */
    const [rootFiles, setRootFiles] = useState([] as FileEntry[]);
    const [selectedPath, setSelectedPath] = useState('');
    const [content, setContent] = useState('');
    const [savedContent, setSavedContent] = useState('');
    const [version, setVersion] = useState('');
    const [mode, setMode] = useState('edit' as 'edit' | 'preview' | 'image');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const openRequestRef = useRef(0);

    useEffect(() => {
      openRequestRef.current += 1;
      setRootFiles([]);
      setSelectedPath('');
      setContent('');
      setSavedContent('');
      setVersion('');
      setMode('edit');
      if (!workspace) return undefined;
      let active = true;
      setLoading(true);
      listFiles(sdk.fetchJSON, '')
        .then(files => active && setRootFiles(files))
        .catch(error => active && setMessage(String(error)))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
        openRequestRef.current += 1;
      };
    }, [workspace?.id]);

    /** Read selected text files; route images directly to read-only previews. */
    const openFile = useCallback(async (entry: FileEntry) => {
      if (!workspace) return;
      if (content !== savedContent && !window.confirm(sourceText("当前文件尚未保存，仍要切换吗？ / Discard unsaved changes?", "Discard unsaved changes?"))) return;
      const requestId = ++openRequestRef.current;
      setSelectedPath(entry.path);
      setMessage('');
      if (isImagePath(entry.path)) {
        setLoading(false);
        setContent('');
        setSavedContent('');
        setVersion('');
        setMode('image');
        return;
      }
      setMode(isMarkdownPath(entry.path) ? 'preview' : 'edit');
      setLoading(true);
      try {
        const document = await readFile(sdk.fetchJSON, entry.path);
        if (openRequestRef.current !== requestId) return;
        setContent(document.content);
        setSavedContent(document.content);
        setVersion(document.version);
        setMode(isMarkdownPath(entry.path) ? 'preview' : 'edit');
      } catch (error) {
        if (openRequestRef.current !== requestId) return;
        setMessage(String(error));
      } finally {
        if (openRequestRef.current === requestId) setLoading(false);
      }
    }, [content, savedContent, workspace?.id]);

    /** Save the complete document and clear the unsaved state only after success. */
    const save = useCallback(async () => {
      if (!workspace || !selectedPath || content === savedContent) return;
      setMessage(sourceText("保存中… / Saving…", "Saving…"));
      try {
        const saved = await writeFile(sdk.fetchJSON, selectedPath, content, version);
        setSavedContent(content);
        setVersion(saved.version);
        setMessage(sourceText("已保存 / Saved", "Saved"));
      } catch (error) {
        setMessage(String(error));
      }
    }, [content, savedContent, selectedPath, version, workspace?.id]);

    useEffect(() => {
      if (content === savedContent) return undefined;
      /** Warn before a browser navigation drops unsaved editor content. */
      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', warn);
      return () => window.removeEventListener('beforeunload', warn);
    }, [content, savedContent]);

    /** Capture the standard save shortcut inside Workbench. */
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };

    if (!workspace) return element(React, 'div', { className: 'hti-panel-empty' },
      element(React, 'strong', null, sourceText("未绑定工作区 / No workspace", "No workspace")),
      element(React, 'span', null, sourceText("每个会话需要绑定一个工作区。 / Bind one workspace to this session.", "Bind one workspace to this session.")));

    return element(React, 'div', { className: 'hti-workspace-panel', onKeyDown: handleKeyDown },
      element(React, 'aside', { className: 'hti-file-tree' },
        element(React, 'div', { className: 'hti-file-tree-heading', title: workspace.path },
          element(React, 'strong', null, workspace.name),
          element(React, 'span', null, workspace.path)),
        element(React, 'ul', { className: 'hti-tree-root' },
          loading && rootFiles.length === 0 ? element(React, 'li', { className: 'hti-tree-loading' }, sourceText("加载中… / Loading…", "Loading…")) : null,
          ...rootFiles.map((entry: FileEntry) => entry.type === 'directory'
            ? element(React, DirectoryNode, { key: entry.path, entry, workspaceId: workspace.id, onOpen: openFile })
            : element(React, 'li', { key: entry.path },
              element(React, 'button', {
                type: 'button',
                className: `hti-tree-row${entry.path === selectedPath ? ' is-active' : ''}`,
                onClick: () => openFile(entry),
                title: entry.path,
              },
                element(React, 'span', { className: 'hti-file-icon', 'aria-hidden': true }, fileIcon(entry)),
                element(React, 'span', null, entry.name)))))),
      element(React, 'section', { className: 'hti-editor-pane' },
        selectedPath ? element(React, React.Fragment, null,
          element(React, 'header', { className: 'hti-editor-header' },
            element(React, 'div', { className: 'hti-editor-path', title: selectedPath },
              element(React, 'strong', null, selectedPath.split('/').at(-1)),
              element(React, 'span', null, selectedPath)),
            element(React, 'div', { className: 'hti-editor-actions' },
              isMarkdownPath(selectedPath) ? element(React, 'div', { className: 'hti-segmented' },
                element(React, 'button', { type: 'button', className: mode === 'edit' ? 'active' : '', onClick: () => setMode('edit') }, sourceText("源码 / Source", "Source")),
                element(React, 'button', { type: 'button', className: mode === 'preview' ? 'active' : '', onClick: () => setMode('preview') }, sourceText("预览 / Preview", "Preview"))) : null,
              !isImagePath(selectedPath) ? element(React, 'button', {
                type: 'button', className: 'hti-save-button', disabled: content === savedContent, onClick: save,
              }, content === savedContent ? sourceText("已保存 / Saved", "Saved") : sourceText("保存 / Save", "Save")) : null)),
          message ? element(React, 'div', { className: 'hti-editor-message', role: 'status' }, message) : null,
          mode === 'image'
            ? element(React, ImagePreview, { key: selectedPath, path: selectedPath })
            : mode === 'preview'
            ? element(React, 'article', {
              className: 'hti-markdown-preview hti-rich-text',
              dangerouslySetInnerHTML: { __html: renderMarkdownHtml(content) },
            })
            : element(React, CodeEditor, { key: selectedPath, path: selectedPath, value: content, onChange: setContent }))
          : element(React, 'div', { className: 'hti-panel-empty' },
            element(React, 'strong', null, sourceText("选择文件 / Select a file", "Select a file")),
            element(React, 'span', null, sourceText("从左侧文件树打开文件。 / Open a file from the tree.", "Open a file from the tree.")))));
  };
}
