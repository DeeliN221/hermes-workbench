import { afterEach, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { installSidecarLoader } from '../dashboard/src/sidecar-loader';
afterEach(() => vi.unstubAllGlobals());
function fixture(url = 'http://localhost/') {
  const window = new Window({ url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true } });
  vi.stubGlobal('window', window); vi.stubGlobal('document', window.document);
  const register = vi.fn();
  const host = Object.assign(window, {
    __HERMES_PLUGIN_SDK__: { React: { createElement: (type: string, props: object, ...children: unknown[]) => ({ type, props, children }) } },
    __HERMES_PLUGINS__: { register },
    __HERMES_WORKBENCH_SIDECAR__: { status: 'idle' },
  });
  return { window, host, register };
}
it('loads one script and stylesheet, and accepts registration by the application', async () => {
  const { window, host } = fixture();
  installSidecarLoader(); installSidecarLoader();
  expect(window.document.querySelectorAll('script')).toHaveLength(1);
  expect(window.document.querySelectorAll('link')).toHaveLength(1);
  const script = window.document.querySelector('script')!;
  expect(script.src).toMatch(/\/workbench-sidecar\/v\/dev\/workbench.js$/);
  expect(window.document.querySelector('link')!.href).toMatch(/\/workbench-sidecar\/v\/dev\/workbench.css$/);
  host.__HERMES_WORKBENCH_SIDECAR__.status = 'loaded';
  script.dispatchEvent(new window.Event('load'));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('loaded');
});
it('falls back to the host plugin URL before offering a retry', () => {
  const { window, host, register } = fixture();
  installSidecarLoader();
  window.document.querySelector('script')!.dispatchEvent(new window.Event('error'));
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('loading');
  const fallback = window.document.querySelector('script')!;
  expect(fallback.src).toMatch(/\/dashboard-plugins\/workbench\/dist\/workbench.js\?v=dev$/);
  expect(window.document.querySelectorAll('script')).toHaveLength(1);

  fallback.dispatchEvent(new window.Event('error'));
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('error');
  const status = register.mock.calls.at(-1)![1]();
  expect(status.props.role).toBe('alert');
  status.children[2].props.onClick();
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('loading');
  expect(window.document.querySelectorAll('script')).toHaveLength(1);
});
it('reports incompatible registration rather than declaring success on a script load', async () => {
  const { window, host } = fixture();
  installSidecarLoader();
  window.document.querySelector('script')!.dispatchEvent(new window.Event('load'));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('error');
});

it('shows the cached message tail while the runtime downloads', () => {
  const { window, register } = fixture('http://localhost/?session=session-1&profile=default');
  window.localStorage.setItem('hermes-workbench.codex-snapshot.v1:default%00session-1', JSON.stringify({
    cachedAt: Date.now(),
    turnId: '',
    messages: [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'latest answer' },
    ],
  }));

  installSidecarLoader();
  const status = register.mock.calls[0][1]();

  expect(status.children[1].props.className).toBe('workbench-sidecar-preview');
  expect(status.children[1].children[1].children[1].children[0]).toBe('earlier question');
  expect(status.children[1].children[2].children[1].children[0]).toBe('latest answer');
});
