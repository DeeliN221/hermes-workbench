import path from 'node:path';
import { defineConfig } from 'vite';
import { selfHostedDiagramRuntimes } from './vite.config';

export default defineConfig({
  root: 'dashboard', publicDir: false,
  define: { __WORKBENCH_STANDALONE__: true },
  plugins: [selfHostedDiagramRuntimes()],
  build: { outDir: 'standalone-dist', emptyOutDir: true,
    rollupOptions: { input: path.resolve('dashboard/standalone.html') } },
});
