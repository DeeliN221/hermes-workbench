import { defineConfig } from 'vite';
/** Build the stable loader separately; it must not import the application runtime. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dashboard/dist', emptyOutDir: false,
    lib: { entry: 'dashboard/loader.ts', name: 'WorkbenchLoader', formats: ['iife'], fileName: () => 'loader.js' },
  },
});
