/** Adapt directory deep links to the native Files page's existing path form. */
export function openFilesDirectory(path: string): void {
  const query = new URLSearchParams({ path });
  const profile = new URLSearchParams(window.location.search).get('profile');
  if (profile) query.set('profile', profile);
  window.history.pushState(null, '', `/files?${query}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function installFilesDirectoryNavigation(): () => void {
  let stopPending = () => {};
  const navigate = () => {
    stopPending();
    if (window.location.pathname !== '/files') return;
    const path = new URLSearchParams(window.location.search).get('path');
    if (!path) return;
    let finished = false;
    let frame = 0;
    const observer = new MutationObserver(() => schedule());
    const stop = () => { finished = true; observer.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); };
    const timer = window.setTimeout(stop, 15000);
    stopPending = stop;
    const apply = () => {
      frame = 0;
      if (finished) return;
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Path"], input[aria-label="路径"]');
      const form = input?.closest('form');
      // The input appears only after native Files finishes loading its initial directory.
      if (!input || !form) return;
      if (input.value === path) { stop(); return; }
      observer.disconnect();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, path);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // React must commit its controlled input before the form's submit callback reads it.
      frame = requestAnimationFrame(() => {
        if (finished) return;
        stop();
        if (form.isConnected) form.requestSubmit();
      });
    };
    const schedule = () => { if (!finished && !frame) frame = requestAnimationFrame(apply); };
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  };
  window.addEventListener('popstate', navigate);
  navigate();
  return () => { stopPending(); window.removeEventListener('popstate', navigate); };
}
