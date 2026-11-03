import type { FetchJSON } from './workbench-api';
import { currentProfile } from './profile-scope';
import { uiText } from './ui-locale';
const CHANGE = 'workbench:attachment-preferences-change';
const endpoint = (profile: string) => `/api/plugins/workbench/attachment-preferences?profile=${encodeURIComponent(profile)}`;
export async function loadFolderUpload(read: FetchJSON, profile: string): Promise<boolean> {
  return (await read<{ folderUploadEnabled: boolean }>(endpoint(profile))).folderUploadEnabled === true;
}
export async function saveFolderUpload(read: FetchJSON, profile: string, enabled: boolean): Promise<boolean> {
  const result = await read<{ folderUploadEnabled: boolean }>(endpoint(profile), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUploadEnabled: enabled }),
  });
  window.dispatchEvent(new CustomEvent(CHANGE, { detail: { profile, enabled: result.folderUploadEnabled === true } }));
  return result.folderUploadEnabled === true;
}
export function useFolderUpload(sdk: any, profile: string): boolean {
  const [state, setState] = sdk.hooks.useState({ profile, enabled: false });
  sdk.hooks.useEffect(() => {
    let active = true, revision = 0;
    const update = (event: CustomEvent<{ profile: string; enabled: boolean }>) => {
      if (event.detail.profile !== profile) return;
      revision++;
      setState({ profile, enabled: event.detail.enabled });
    };
    window.addEventListener(CHANGE, update as EventListener);
    loadFolderUpload(sdk.fetchJSON, profile).then(enabled => {
      if (active && revision === 0) setState({ profile, enabled });
    }).catch(() => { /* Optional entry stays hidden if settings cannot be read. */ });
    return () => { active = false; window.removeEventListener(CHANGE, update as EventListener); };
  }, [profile, sdk.fetchJSON]);
  return state.profile === profile && state.enabled;
}
export function renderFolderUploadSetting(panel: HTMLElement, read: FetchJSON, profile = currentProfile()): void {
  const section = document.createElement('section');
  section.className = 'workbench-chat-display-toggle';
  const copy = document.createElement('div');
  copy.className = 'workbench-chat-display-toggle-copy';
  const label = document.createElement('strong');
  label.textContent = uiText('启用文件夹上传', 'Enable folder uploads');
  const description = document.createElement('span');
  description.textContent = uiText('在此档案的聊天输入区显示文件夹上传入口。', 'Show the folder upload entry in this profile’s chat composer.');
  copy.append(label, description);
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'workbench-chat-display-switch';
  button.dataset.testid = 'folder-upload-toggle'; button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', label.textContent); button.setAttribute('aria-checked', 'false');
  button.textContent = uiText('关闭', 'Off'); button.disabled = true;
  const apply = (enabled: boolean) => { button.setAttribute('aria-checked', String(enabled)); button.textContent = enabled ? uiText('开启', 'On') : uiText('关闭', 'Off'); };
  const error = document.createElement('span'); error.setAttribute('role', 'status');
  loadFolderUpload(read, profile).then(enabled => { apply(enabled); button.disabled = false; }).catch(() => { error.textContent = uiText('无法读取设置。', 'Could not load settings.'); });
  button.addEventListener('click', async () => {
    button.disabled = true; error.textContent = '';
    try { apply(await saveFolderUpload(read, profile, button.getAttribute('aria-checked') !== 'true')); }
    catch { error.textContent = uiText('保存失败，请重试。', 'Could not save. Please retry.'); }
    finally { button.disabled = false; }
  });
  section.append(copy, button, error); panel.append(section);
}
