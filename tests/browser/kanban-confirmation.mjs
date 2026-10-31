/**
 * Exercise the built Workbench shell against the host's body-portal contract.
 * ConfirmDialog (SDK @nous-research/ui 0.18.2) renders a fixed z-50 backdrop
 * followed by a role=alertdialog sibling and locks body pointer events.
 * This deterministic fixture models that boundary; it does not ship a second
 * React/Radix runtime. Native-plugin/SDK acceptance is recorded separately.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const host = await createMockHost();
const shotDir = process.env.KANBAN_CONFIRMATION_SHOT_DIR;
if (shotDir) await mkdir(shotDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'], executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });

// A click can reach an INVISIBLE dialog through Radix's pointer-disabled
// foreground. Playwright's visible/actionable checks alone miss this bug.
// Briefly enable hit testing on body children to measure the actual layer order.
async function assertPaintedAboveBoard(page) {
  const painted = await page.evaluate(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    const children = Array.from(document.body.children).filter(node => node instanceof HTMLElement);
    const styles = children.map(node => [node, node.style.pointerEvents]);
    for (const node of children) node.style.pointerEvents = 'auto';
    try {
      const box = dialog.getBoundingClientRect();
      return {
        content: dialog.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
        backdrop: document.elementFromPoint(10, 10)?.id === 'host-confirm-backdrop',
      };
    } finally {
      for (const [node, value] of styles) node.style.pointerEvents = value;
    }
  });
  assert.deepEqual(painted, { content: true, backdrop: true }, 'confirmation and backdrop must paint above the board, drawer and floating close button');
}

async function installNativeBoundary(page) {
  await page.addStyleTag({ content: `
    #native-board{margin-left:280px;padding:24px;background:var(--color-card);min-height:80vh}
    @media(max-width:800px){#native-board{margin-left:48px}}
    .hermes-kanban-drawer-shade{position:fixed;inset:0;background:#0006;display:flex;justify-content:flex-end;z-index:60}
    .hermes-kanban-drawer{width:min(600px,95vw);height:100vh;background:var(--color-card);display:flex;flex-direction:column}
    .hermes-kanban-drawer-head{display:flex;justify-content:space-between}
    .hermes-kanban-drawer-body{overflow:auto}
    .fixed{position:fixed}.inset-0{inset:0}.z-50{z-index:50}
    #host-confirm-backdrop{background:#0009}
    #host-confirm{top:50%;left:50%;transform:translate(-50%,-50%);width:min(420px,85vw);padding:24px;background:var(--color-card);border:2px solid var(--color-border)}
    #host-confirm h2{margin:0 0 16px}#host-confirm button{margin:16px 8px 0 0;padding:8px}
    [hidden]{display:none!important}
  ` });
  await page.evaluate(() => {
    const aside = document.createElement('aside'); aside.id = 'app-sidebar';
    const host = document.createElement('div'); host.id = 'native-board';
    host.innerHTML = '<header role="banner">Kanban</header><button id="open-card">home-only repo</button><span id="task-status">todo</span><output id="heartbeat">0</output>';
    document.body.prepend(aside, host);
    let ticks = 0;
    const timer = setInterval(() => { host.querySelector('#heartbeat').textContent = String(++ticks); }, 100);
    const closeDrawer = () => host.querySelector('.hermes-kanban-drawer-shade')?.remove();
    let settle;
    function requestConfirmation() {
      if (settle) return Promise.resolve(false);
      return new Promise(resolve => {
        const priorPointer = document.body.style.pointerEvents;
        const priorFocus = document.activeElement;
        const backdrop = document.createElement('div'); backdrop.id = 'host-confirm-backdrop';
        backdrop.className = 'fixed inset-0 z-50'; backdrop.dataset.state = 'open';
        const dialog = document.createElement('div'); dialog.id = 'host-confirm';
        dialog.className = 'fixed z-50'; dialog.dataset.state = 'open';
        dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'host-confirm-title');
        dialog.innerHTML = '<h2 id="host-confirm-title">Confirm change</h2><p>Archive this task?</p><button id="cancel">Cancel</button><button id="confirm">Confirm</button>';
        document.body.append(backdrop, dialog);
        document.body.style.pointerEvents = 'none';
        backdrop.style.pointerEvents = dialog.style.pointerEvents = 'auto';
        const key = event => { if (event.key === 'Escape') { event.preventDefault(); settle(false); } };
        settle = confirmed => {
          settle = undefined;
          document.removeEventListener('keydown', key);
          dialog.remove(); backdrop.remove(); document.body.style.pointerEvents = priorPointer;
          if (priorFocus?.isConnected) priorFocus.focus();
          resolve(confirmed);
        };
        document.addEventListener('keydown', key);
        dialog.querySelector('#cancel').onclick = () => settle(false);
        dialog.querySelector('#confirm').onclick = () => settle(true);
        dialog.querySelector('#cancel').focus();
      });
    }
    host.querySelector('#open-card').onclick = () => {
      if (host.querySelector('.hermes-kanban-drawer')) return;
      const shade = document.createElement('div'); shade.className = 'hermes-kanban-drawer-shade';
      shade.innerHTML = `<section class="hermes-kanban-drawer">
        <header class="hermes-kanban-drawer-head"><span>t_2d0f0a85</span><button aria-label="Close task">×</button></header>
        <div class="hermes-kanban-drawer-body"><div class="hermes-kanban-drawer-title">home-only repo</div>
          <div><div class="hermes-kanban-actions"><button>Archive</button></div><p role="status" id="action-status"></p></div>
          <section><div class="hermes-kanban-section-head">Dependencies</div><input aria-label="Dependency note"></section>
        </div>
        <div class="hermes-kanban-drawer-comment-foot"><div class="hermes-kanban-drawer-comment-row"><input><button>Comment</button></div></div>
      </section>`;
      host.append(shade);
      shade.querySelector('[aria-label="Close task"]').onclick = closeDrawer;
      shade.querySelector('.hermes-kanban-actions button').onclick = async () => {
        if (!await requestConfirmation()) return;
        const status = shade.querySelector('#action-status');
        try {
          await window.__HERMES_PLUGIN_SDK__.fetchJSON('/api/plugins/kanban/tasks/t_2d0f0a85?board=default', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }),
          });
          host.querySelector('#task-status').textContent = 'archived'; status.textContent = 'Archived';
        } catch { status.textContent = 'Archive failed'; }
      };
    };
    addEventListener('popstate', () => { if (location.pathname !== '/kanban') { settle?.(false); clearInterval(timer); aside.remove(); host.remove(); } });
  });
}

try {
  const fixture = await (await fetch(host.origin + '/sessions')).text();
  for (const [label, viewport, panel] of [
    ['floating', { width: 1920, height: 950 }, true],
    ['standalone', { width: 1280, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, false],
  ]) {
    const page = await browser.newPage({ viewport }); page.setDefaultTimeout(8000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let patches = 0, fail = false;
    await page.route('**/kanban?**', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.fallback());
    await page.route('**/api/plugins/kanban/**', route => {
      if (route.request().method() === 'PATCH') {
        patches++;
        assert.deepEqual(route.request().postDataJSON(), { status: 'archived' });
        return route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
        route.request().url().includes('/profiles') ? { profiles: [{ name: 'default' }] }
          : { task: { id: 't_2d0f0a85', assignee: 'default', status: 'todo' }, runs: [], attachments: [] },
      ) });
    });
    await page.goto(host.origin + `/kanban?board=default&profile=default${panel ? '&panel=1' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.workbenchShell === 'true');
    await installNativeBoundary(page);
    const open = async () => {
      await page.locator('#open-card').click();
      await page.getByRole('tab', { name: 'Dependencies and settings' }).click();
    };
    const archive = () => page.locator('[data-wb-action="archive"]').click();
    await open(); await archive();
    await page.getByRole('alertdialog').waitFor();
    assert.equal(patches, 0, 'confirmation must precede the mutation request');
    await assertPaintedAboveBoard(page);
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `${label}-confirmation.png`) });
    const before = Number(await page.locator('#heartbeat').textContent());
    await page.waitForFunction(value => Number(document.querySelector('#heartbeat').textContent) > value, before);
    await page.locator('#cancel').click();
    assert.equal(patches, 0);
    await page.getByRole('textbox', { name: 'Dependency note' }).fill('interactive after cancel');

    // Repeated open/cancel does not leave a modal lock or duplicate a request.
    for (let i = 0; i < 3; i++) {
      await archive(); await assertPaintedAboveBoard(page); await page.keyboard.press('Escape');
      assert.equal(await page.locator('[role="alertdialog"]').count(), 0);
    }
    await archive(); await page.locator('#confirm').dblclick();
    await page.locator('#action-status').filter({ hasText: /^Archived$/ }).waitFor();
    assert.equal(patches, 1, 'a repeated confirmation must not duplicate the mutation');
    assert.equal(await page.locator('#task-status').textContent(), 'archived');
    await page.getByRole('button', { name: 'Close task' }).click(); await open();
    fail = true; await archive(); await page.locator('#confirm').click();
    await page.locator('#action-status').filter({ hasText: 'Archive failed' }).waitFor();
    await page.getByRole('textbox', { name: 'Dependency note' }).fill('interactive after failure');
    assert.equal(await page.evaluate(() => document.body.style.pointerEvents), '');
    await page.getByRole('button', { name: 'Close task' }).click(); await open();
    fail = false; await archive(); await assertPaintedAboveBoard(page); await page.locator('#confirm').click();
    await page.locator('#action-status').filter({ hasText: /^Archived$/ }).waitFor();
    assert.equal(patches, 3);
    if (panel) {
      await page.locator('.dashboard-accessory-close').click();
      await page.locator('.codex-composer textarea').first().fill('interactive after closing floating board');
      assert.equal(await page.locator('.dashboard-global-nav').evaluate(node => node.inert), false);
      const unrelatedLayer = await page.evaluate(() => {
        const dialog = document.createElement('div');
        dialog.className = 'fixed z-50'; dialog.setAttribute('role', 'alertdialog');
        document.body.append(dialog);
        const layer = getComputedStyle(dialog).zIndex; dialog.remove(); return layer;
      });
      assert.equal(unrelatedLayer, '50', 'other tools must retain the host modal layering');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${label}: painted modal, live event loop, cancel/Escape, repeated clicks, PATCH success/failure, close/reopen`);
    await page.close();
  }
} finally { await browser.close(); await host.close(); }
