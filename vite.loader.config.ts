import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Build the stable loader separately; it must not import the application runtime. */
export default defineConfig({
  publicDir: false,
  // The release version is the cache key for the immutable runtime assets.
  define: { __WORKBENCH_BUILD_VERSION__: JSON.stringify(packageJson.version) },
  build: {
    outDir: 'dashboard/dist', emptyOutDir: false,
    lib: { entry: 'dashboard/loader.ts', name: 'WorkbenchLoader', formats: ['iife'], fileName: () => 'loader.js' },
  },
});
