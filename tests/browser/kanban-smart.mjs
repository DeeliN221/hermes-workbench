/**
 * Kanban progress, assignee suggestion, and the capacity notice in a real browser.
 *
 * The native Kanban page markup is reproduced from the installed plugin so the
 * Workbench compatibility modules are exercised against the same class names,
 * on desktop and phone widths and in both themes.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createMockHost } from './mock-host.mjs';

const shotDir = process.env.KANBAN_SHOT_DIR || '';
const overview = {
  available: true,
  board: 'workbench',
  stats: {
    tasks_total: 6,
    by_status: { running: 1, blocked: 1, review: 1, done: 3 },
    runs_total: 9,
    runs_completed: 5,
    runs_failed: 2,
    runs_in_flight: 1,
    runs_neutral: 1,
    success_rate: 0.7143,
  },
  tasks: [
    {
      task_id: 't_running', title: 'Refactor the deployment pipeline', status: 'running', assignee: 'project-manager',
      summary: '', failure: '', run_count: 2, completed_runs: 1, failed_runs: 1,
      latest_run: { id: 11, status: 'running', outcome: '', summary: 'Building the release bundle', started_at: 1, ended_at: null },
    },
    {
      task_id: 't_done', title: 'Ship the board overview', status: 'done', assignee: 'project-manager',
      summary: 'Delivered the board overview with delivery statistics and per-card output summaries.', failure: '',
      run_count: 3, completed_runs: 2, failed_runs: 1,
      latest_run: { id: 12, status: 'done', outcome: 'completed', summary: 'Delivered the board overview', started_at: 2, ended_at: 3 },
    },
    {
      task_id: 't_blocked', title: 'Waiting on provider keys', status: 'blocked', assignee: 'default',
      summary: '', failure: 'Provider refused the request because capacity is exhausted', run_count: 1,
      completed_runs: 0, failed_runs: 0, latest_run: { id: 13, status: 'blocked', outcome: 'blocked', summary: 'Waiting for input', started_at: 4, ended_at: null },
    },
    {
      task_id: 't_new', title: 'Refactor the frontend deployment pipeline', status: 'todo', assignee: '',
      summary: '', failure: '', run_count: 0, completed_runs: 0, failed_runs: 0, latest_run: null,
    },
  ],
};

const boardMarkup = `
  <div id="kanban-root" style="min-height:100dvh">
    <header style="display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--color-border)">
      <strong>workbench</strong><span style="color:var(--color-muted-foreground)">Kanban</span>
    </header>
    <div class="hermes-kanban-columns">
      ${[
        ['running', 'Running', ['t_running', 'Refactor the deployment pipeline']],
        ['done', 'Done', ['t_done', 'Ship the board overview']],
        ['blocked', 'Blocked', ['t_blocked', 'Waiting on provider keys']],
        ['todo', 'Todo', ['t_new', 'Refactor the frontend deployment pipeline']],
      ].map(([status, label, task]) => `
        <section class="hermes-kanban-column" data-kanban-column="${status}">
          <div class="hermes-kanban-column-header"><span class="hermes-kanban-column-label">${label}</span></div>
          <div class="hermes-kanban-column-body">
            <article class="hermes-kanban-card" data-task-id="${task[0]}">
              <div class="hermes-kanban-card-content">
                <div class="hermes-kanban-card-row"><strong class="hermes-kanban-card-title">${task[1]}</strong></div>
                <div class="hermes-kanban-card-meta">${status === 'todo' ? 'unassigned' : 'project-manager'}</div>
              </div>
            </article>
          </div>
        </section>`).join('')}
    </div>
    <form class="hermes-kanban-create-dialog" style="margin:16px;padding:16px;border:1px solid var(--color-border);border-radius:8px;max-width:520px">
      <div class="hermes-kanban-dialog-title">New task — Todo</div>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1"><label>Title</label><textarea rows="2" placeholder="New task title…"></textarea></div>
        <div class="flex gap-2">
          <div class="flex flex-col gap-1 flex-1"><label>Assignee<small>(blank = dispatcher picks)</small></label><input placeholder="assignee"></div>
          <div class="flex flex-col gap-1 w-20"><label>Priority</label><input type="number" placeholder="pri"></div>
        </div>
      </div>
      <footer style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button type="button">Cancel</button><button type="button">Create</button>
      </footer>
    </form>
  </div>`;

const themeStyles = `
  :root {
    --color-background: #f5f7f5; --color-card: #ffffff; --color-popover: #ffffff;
    --color-foreground: #16201a; --color-card-foreground: #16201a; --color-popover-foreground: #16201a;
    --color-muted: #eef2ee; --color-muted-foreground: #5b6b61; --color-border: #d6ded8;
    --color-primary: #2f7d57; --color-primary-foreground: #ffffff; --color-secondary: #e9efea;
    --color-secondary-foreground: #22302a; --color-accent: #e3ece6; --color-accent-foreground: #16201a;
    --color-destructive: #b3403a; --background-base: #f5f7f5; --midground-base: #ffffff;
    color-scheme: light;
  }
  html[data-workbench-theme="dark"] {
    --color-background: #0b1512; --color-card: #121e19; --color-popover: #16241f;
    --color-foreground: #e7efe9; --color-card-foreground: #e7efe9; --color-popover-foreground: #e7efe9;
    --color-muted: #1a2822; --color-muted-foreground: #9db2a6; --color-border: #2c3d35;
    --color-primary: #59c795; --color-primary-foreground: #06140d; --color-secondary: #1b2a24;
    --color-secondary-foreground: #dfeae3; --color-accent: #23352c; --color-accent-foreground: #e7efe9;
    --color-destructive: #e0655f; --background-base: #0b1512; --midground-base: #121e19;
    color-scheme: dark;
  }
  body { margin: 0; background: var(--color-background); color: var(--color-foreground); font: 14px/1.5 system-ui, sans-serif; }
  .hermes-kanban-columns { display: flex; gap: 12px; padding: 12px; align-items: flex-start; flex-wrap: wrap; }
  .hermes-kanban-column {
    flex: 1 1 0; min-width: 0; padding: 8px; border: 1px solid var(--color-border); border-radius: 8px;
  }
  .hermes-kanban-card {
    margin: 6px 0; padding: 10px; border: 1px solid var(--color-border); border-radius: 6px;
    background: var(--color-card); color: var(--color-card-foreground);
  }
  .hermes-kanban-card-content { min-width: 0; overflow-wrap: anywhere; }
  .hermes-kanban-card-meta { font-size: 11px; color: var(--color-muted-foreground); }
  @media (max-width: 640px) {
    .hermes-kanban-columns { flex-direction: column; }
    .hermes-kanban-column { flex: 1 1 100%; width: 100%; box-sizing: border-box; }
  }
  .hermes-kanban-create-dialog label { font-size: 12px; color: var(--color-foreground); }
  .hermes-kanban-create-dialog textarea, .hermes-kanban-create-dialog input, .hermes-kanban-create-dialog select {
    width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--color-border);
    border-radius: 6px; background: var(--color-popover); color: var(--color-popover-foreground); font: inherit;
  }
`;

function luminance(color) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
  if (!match) return 1;
  const [red, green, blue] = match.slice(1, 4).map(value => Number(value) / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function newPage(browser, host, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.__errors = errors;

  const created = [];
  page.__created = created;
  const fixture = await (await fetch(host.origin + '/sessions')).text();
  await page.route('**/kanban**', route => route.request().resourceType() === 'document'
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture })
    : route.fallback());
  await page.route('**/api/plugins/workbench/kanban-overview', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) }));
  await page.route('**/api/plugins/kanban/profiles**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      profiles: ['default', 'project-manager', 'writer', 'career-coach'].map(name => ({ name })),
    }) }));
  await page.route('**/api/plugins/kanban/tasks**', route => {
    created.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task: { id: 't_created' } }) });
  });
  await page.addInitScript(styles => {
    window.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = styles;
      document.head.append(style);
    });
  }, themeStyles);
  await page.goto(host.origin + '/kanban?board=workbench', { waitUntil: 'domcontentloaded' });
  await page.evaluate(markup => {
    document.body.insertAdjacentHTML('beforeend', markup);
    const style = document.createElement('style');
    style.textContent = ':root{--wb-line:var(--color-border);--wb-muted:var(--color-muted-foreground);--wb-panel:var(--color-card);--wb-radius:6px}';
    document.head.append(style);
  }, boardMarkup);
  return page;
}

async function setTheme(page, theme) {
  await page.evaluate(value => {
    localStorage.setItem('hermes-dashboard-theme', value);
    document.documentElement.dataset.workbenchTheme = value;
    document.documentElement.classList.toggle('dark', value === 'dark');
  }, theme);
}

async function capture(page, name) {
  if (!shotDir) return;
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: false });
}

const host = await createMockHost();
if (shotDir) await mkdir(shotDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
try {
  const page = await newPage(browser, host, { width: 1440, height: 900 });
  const strip = page.locator('.hti-kanban-overview');
  await strip.waitFor({ state: 'visible', timeout: 8000 });
  const stripText = (await strip.textContent() || '').replace(/\s+/g, ' ');
  assert.match(stripText, /71%/);
  assert.match(stripText, /5\/7/);
  assert.match(stripText, /Running 1/);
  assert.match(stripText, /Review 1/);
  assert.match(stripText, /Done 3/);

  const runningCard = page.locator('.hermes-kanban-card[data-task-id="t_running"] .hti-kanban-stage');
  await runningCard.waitFor({ state: 'visible', timeout: 5000 });
  const runningText = (await runningCard.textContent() || '').replace(/\s+/g, ' ');
  assert.match(runningText, /Running/);
  assert.match(runningText, /run 2/);
  const doneResult = await page.locator('.hermes-kanban-card[data-task-id="t_done"] .hti-kanban-result').textContent();
  assert.match(doneResult || '', /board overview/);
  const blocked = await page.locator('.hermes-kanban-card[data-task-id="t_blocked"] .hti-kanban-result').textContent();
  assert.match(blocked || '', /capacity is exhausted/);
  await capture(page, 'kanban-desktop-light');

  // Create dialog: typing a title prefills the matching installed profile.
  const dialog = page.locator('.hermes-kanban-create-dialog');
  await dialog.getByPlaceholder('New task title…').fill('Refactor the frontend deployment pipeline');
  await dialog.getByPlaceholder('Why now, current state, materials, decisions, hard constraints').fill('The kanban board needs one-click assignment.');
  await dialog.getByPlaceholder('What to deliver, where, format, and audience').fill('A reviewed pull request with tests.');
  await dialog.getByPlaceholder('One per line, up to five measurable criteria').fill('Tests pass');
  await dialog.getByPlaceholder('One per line; what not to do and when to stop').fill('Do not auto-merge');
  const assistantSelect = dialog.locator('.hti-kanban-create-assignee select');
  await assistantSelect.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelector('.hti-kanban-create-assignee select')?.value === 'project-manager',
    null,
    { timeout: 5000 },
  );
  const hint = await dialog.locator('.hti-kanban-recommendation').textContent();
  assert.match(hint || '', /Recommended project-manager/);
  await dialog.locator('button', { hasText: 'Create' }).click();
  await page.waitForFunction(() => true, null, { timeout: 1000 });
  for (let attempt = 0; attempt < 50 && !page.__created.length; attempt += 1) {
    await page.waitForTimeout(100);
  }
  assert.equal(page.__created.length, 1, 'the create request must be captured once');
  assert.equal(page.__created[0].assignee, 'project-manager');
  assert.match(page.__created[0].title, /frontend deployment/);

  await capture(page, 'kanban-dialog-light');

  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await setTheme(page, 'dark');
  await page.waitForTimeout(250);
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(luminance(lightBackground) > 0.6, `light theme must paint a light surface: ${lightBackground}`);
  assert.ok(luminance(darkBackground) < 0.3, `dark theme must paint a dark surface: ${darkBackground}`);
  await capture(page, 'kanban-desktop-dark');
  assert.deepEqual(page.__errors, [], `Browser errors on desktop: ${page.__errors.join('\n')}`);
  await page.close();

  // Capacity notice: a rendered overload row explains the automatic model switch.
  const chat = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const chatErrors = [];
  chat.on('pageerror', error => chatErrors.push(error.stack || error.message));
  await chat.goto(host.origin + '/chat?session=codex-preview&profile=default', { waitUntil: 'domcontentloaded' });
  await chat.locator('.codex-pane-slot').first().waitFor({ state: 'attached', timeout: 8000 });
  await chat.evaluate(() => {
    const row = document.createElement('article');
    row.className = 'codex-message is-assistant is-error';
    row.setAttribute('role', 'alert');
    const pre = document.createElement('pre');
    pre.textContent = 'Response failed\nSelected model is at capacity. Please try a different model.';
    row.append(pre);
    document.body.append(row);
  });
  const notice = chat.locator('.hti-model-fallback-notice');
  await notice.waitFor({ state: 'visible', timeout: 8000 });
  assert.match((await notice.textContent() || ''), /switching to an available model automatically/);
  await chat.screenshot({ path: shotDir ? path.join(shotDir, 'chat-capacity-light.png') : undefined, fullPage: false });
  await setTheme(chat, 'dark');
  await chat.waitForTimeout(250);
  await chat.screenshot({ path: shotDir ? path.join(shotDir, 'chat-capacity-dark.png') : undefined, fullPage: false });
  assert.deepEqual(chatErrors, [], `Browser errors in the chat notice: ${chatErrors.join('\n')}`);
  await chat.close();

  const phone = await newPage(browser, host, { width: 390, height: 844 });
  await phone.locator('.hti-kanban-overview').waitFor({ state: 'visible', timeout: 8000 });
  await phone.locator('.hermes-kanban-card[data-task-id="t_running"] .hti-kanban-stage').waitFor({ state: 'visible', timeout: 5000 });
  const phoneLayout = await phone.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    stripHeight: document.querySelector('.hti-kanban-overview')?.getBoundingClientRect().height || 0,
    stageWidth: document.querySelector('.hermes-kanban-card[data-task-id="t_running"] .hti-kanban-stage')?.getBoundingClientRect().width || 0,
  }));
  assert.ok(phoneLayout.overflow <= 1, `phone layout must not scroll horizontally: ${phoneLayout.overflow}px`);
  assert.ok(phoneLayout.stripHeight > 20 && phoneLayout.stripHeight < 140, `strip height out of range: ${phoneLayout.stripHeight}`);
  assert.ok(phoneLayout.stageWidth > 0, 'the card stage must be visible on a phone');
  await capture(phone, 'kanban-mobile-light');
  await setTheme(phone, 'dark');
  await phone.waitForTimeout(250);
  const phoneDark = await phone.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.ok(luminance(phoneDark) < 0.3, `phone dark theme must paint a dark surface: ${phoneDark}`);
  await capture(phone, 'kanban-mobile-dark');
  assert.deepEqual(phone.__errors, [], `Browser errors on phone: ${phone.__errors.join('\n')}`);
  await phone.close();

  console.log('Kanban smart board passed: success strip, card stage and result summaries,');
  console.log('create-dialog assignee prefill, capacity notice, desktop and phone, light and dark.');
} finally {
  await browser.close();
  await host.close();
}
