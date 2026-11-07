/** Build-time flag keeps the plugin entry and its host contract unchanged. */
declare const __WORKBENCH_STANDALONE__: boolean;
export const standalone = typeof __WORKBENCH_STANDALONE__ !== 'undefined' && __WORKBENCH_STANDALONE__;
export const runtimeUI = standalone ? '/api/plugins/workbench/runtime-ui' : '/api/plugins/workbench/codex';
