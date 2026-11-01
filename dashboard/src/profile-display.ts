import type { FetchJSON } from './workbench-api';
export const PROFILE_DISPLAY_CHANGED = 'workbench:profile-display-changed';
let aliases: Record<string, string> = {};
export const profileAlias = (profile: string): string => Object.hasOwn(aliases, profile) ? aliases[profile] : '';
export async function loadProfileDisplay(read: FetchJSON): Promise<void> {
  const response = await read<{ aliases: Record<string, string> }>('/api/plugins/workbench/profile-display');
  aliases = response.aliases || {};
  window.dispatchEvent(new Event(PROFILE_DISPLAY_CHANGED));
}
export async function saveProfileDisplay(read: FetchJSON, profile: string, displayName: string): Promise<void> {
  await read(`/api/plugins/workbench/profile-display?profile=${encodeURIComponent(profile)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: displayName }),
  });
  await loadProfileDisplay(read);
}
export function useProfileDisplay(sdk: { hooks: any; fetchJSON: FetchJSON }): void {
  const [, render] = sdk.hooks.useState(0);
  sdk.hooks.useEffect(() => {
    const changed = () => render((n: number) => n + 1);
    window.addEventListener(PROFILE_DISPLAY_CHANGED, changed);
    void loadProfileDisplay(sdk.fetchJSON).catch(() => {});
    return () => window.removeEventListener(PROFILE_DISPLAY_CHANGED, changed);
  }, []);
}
