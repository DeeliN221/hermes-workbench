/** Measure wrapped text as well as explicit newlines, with room for at most ten lines. */
function resizeComposer(input: HTMLTextAreaElement) {
  const style = getComputedStyle(input);
  const lineHeight = parseFloat(style.lineHeight);
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const maxHeight = lineHeight * 10 + padding + border;
  input.style.height = 'auto';
  input.style.overflowY = 'hidden';
  const height = Math.min(input.scrollHeight + border, maxHeight);
  input.style.height = `${height}px`;
  input.style.overflowY = input.scrollHeight > input.clientHeight ? 'auto' : 'hidden';
}

/** Keep keystrokes local to the input, independently of transcript and navigation renders. */
export function createChatComposerInput(sdk: Record<string, any>) {
  const React = sdk.React;
  return function ChatComposerInput({ value, revision, onDraft, inputRef, ...props }: Record<string, any>) {
    const [draft, setDraft] = React.useState(value);
    const localRef = React.useRef(null);
    const setInputRef = React.useCallback((input: HTMLTextAreaElement | null) => {
      localRef.current = input;
      if (typeof inputRef === 'function') inputRef(input);
      else if (inputRef) inputRef.current = input;
    }, [inputRef]);
    React.useLayoutEffect(() => { setDraft(value); }, [value, revision]);
    React.useLayoutEffect(() => {
      if (localRef.current) resizeComposer(localRef.current);
    }, [draft]);
    React.useLayoutEffect(() => {
      const input = localRef.current;
      if (!input) return;
      let width = input.clientWidth;
      const observer = new ResizeObserver(() => {
        if (input.clientWidth === width) return;
        width = input.clientWidth;
        resizeComposer(input);
      });
      observer.observe(input);
      return () => observer.disconnect();
    }, []);
    return React.createElement('textarea', {
      ...props,
      name: props.name || 'message',
      ref: setInputRef,
      rows: 1,
      value: draft,
      onChange: (event: { target: { value: string } }) => {
        const text = event.target.value;
        setDraft(text);
        onDraft(text);
      },
    });
  };
}
