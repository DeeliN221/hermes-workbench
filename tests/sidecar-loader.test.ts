import { afterEach, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { installSidecarLoader } from '../dashboard/src/sidecar-loader';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const window = new Window({ url: 'http://localhost/', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true } });
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
  expect(script.src).toMatch(/\/dashboard-plugins\/workbench\/dist\/workbench.js\?v=/);
  host.__HERMES_WORKBENCH_SIDECAR__.status = 'loaded';
  script.dispatchEvent(new window.Event('load'));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('loaded');
});
it('offers a retry after download failure without accumulating scripts', () => {
  const { window, host, register } = fixture();
  installSidecarLoader();
  window.document.querySelector('script')!.dispatchEvent(new window.Event('error'));
  expect(host.__HERMES_WORKBENCH_SIDECAR__.status).toBe('error');
  const status = register.mock.calls.at(-1)![1]();
  expect(status.props.role).toBe('alert');
  status.children[1].props.onClick();
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
