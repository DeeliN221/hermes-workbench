// Keep native mouse/touch selection intact while Markdown is streaming.
// Only the selected block pauses; incoming content is retained and flushed
// when selection ends. The host owns React, so hooks come from its SDK.
export function useSelectableMarkdown(hooks, root, content, streaming) {
  const latest = hooks.useRef({ content, streaming });
  const dragging = hooks.useRef(false);
  const [displayed, setDisplayed] = hooks.useState({ content, streaming });
  const selected = () => {
    const selection = root.current?.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed) return false;
    for (let index = 0; index < selection.rangeCount; index++) {
      if (selection.getRangeAt(index).intersectsNode(root.current)) return true;
    }
    return false;
  };
  hooks.useEffect(() => {
    latest.current = { content, streaming };
    if (!dragging.current && !selected()) setDisplayed(latest.current);
  }, [content, streaming]);
  hooks.useEffect(() => {
    const element = root.current;
    if (!element) return;
    const doc = element.ownerDocument;
    const flush = () => {
      if (!dragging.current && !selected()) setDisplayed(latest.current);
    };
    const down = event => {
      if (event.button === 0) dragging.current = true;
    };
    const up = () => { dragging.current = false; flush(); };
    element.addEventListener('pointerdown', down);
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', up);
    doc.addEventListener('selectionchange', flush);
    doc.defaultView?.addEventListener('blur', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', up);
      doc.removeEventListener('selectionchange', flush);
      doc.defaultView?.removeEventListener('blur', up);
    };
  }, []);
  return displayed;
}
