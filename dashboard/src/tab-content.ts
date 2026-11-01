/** Resolve the routed canvas, independently of its tag or adjacent plugin slots. */
export function findTabContent(root: Document = document): HTMLElement | null {
  const owned = root.querySelector<HTMLElement>('.dashboard-owned-page');
  if (owned) return owned;
  const sidebar = root.getElementById('app-sidebar');
  // Hermes App renders its route canvas beside the sidebar (relative z-2).
  // Older hosts wrap the route in main; plugin slots may sit between siblings.
  const siblings = sidebar?.parentElement?.children;
  if (siblings) {
    for (const sibling of Array.from(siblings)) {
      if (sibling === sidebar || !(sibling instanceof HTMLElement)) continue;
      if (sibling.matches('main, [role="main"], .relative.z-2') || sibling.querySelector('main, [role="main"], header[role="banner"]')) return sibling;
    }
  }
  return root.querySelector<HTMLElement>('main, [role="main"]');
}
