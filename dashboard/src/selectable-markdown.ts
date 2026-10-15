type SelectionHooks = {
  useRef<T>(value: T): { current: T };
  useState<T>(value: T): [T, (value: T) => void];
  useEffect(effect: () => void | (() => void), dependencies: unknown[]): void;
};
// Keep native mouse/touch selection intact while Markdown is streaming.
// Only the selected block pauses; incoming content is retained and flushed
// when selection ends. The host owns React, so hooks come from its SDK.
export function useSelectableMarkdown(hooks: SelectionHooks, root: { current: HTMLElement | null }, content: string, streaming: boolean) {
  const latest = hooks.useRef({ content, streaming });
  const dragging = hooks.useRef(false);
  const [displayed, setDisplayed] = hooks.useState({ content, streaming });
  const selected = () => {
    const element = root.current;
    const selection = element?.ownerDocument.getSelection();
    if (!element || !selection || selection.isCollapsed) return false;
    for (let index = 0; index < selection.rangeCount; index++) {
      if (selection.getRangeAt(index).intersectsNode(element)) return true;
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
    const down = (event: PointerEvent) => {
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
