/** Serve the current built Workbench bundle for manual local preview. */
import { createMockHost } from '../tests/browser/mock-host.mjs';

const host = process.env.WORKBENCH_PREVIEW_HOST || '127.0.0.1';
const port = Number(process.env.WORKBENCH_PREVIEW_PORT || 9130);
const preview = await createMockHost({ host, port });
console.log(`Workbench local preview: ${preview.origin}/sessions?profile=default`);
console.log('Mock Hermes data only; no NAS, production data, or Codex credentials are used.');

let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await preview.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
