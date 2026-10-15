#!/usr/bin/env node
// Requires Playwright and Chromium. See dev.md for the reproduction command.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets/screenshots');
const output = path.join(root, 'assets/showcase');

// Code-drawn browser controls keep the original application captures untouched.
const paths = {
  back: '<path d="m14 5-7 7 7 7"/>',
  forward: '<path d="m10 5 7 7-7 7"/>',
  reload: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  sliders: '<path d="M4 7h4m4 0h8M4 17h8m4 0h4"/><circle cx="10" cy="7" r="2"/><circle cx="14" cy="17" r="2"/>',
  shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m7 7 10 10M7 17 17 7"/>',
  tabs: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  bookmark: '<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  share: '<path d="M8 11H5v10h14V11h-3M12 15V2m-4 4 4-4 4 4"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M22 10v4M6 10h10v4H6z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const mark = '<span class="mark">W</span>';
const desktop = `<div class="tabstrip"><span class="lights"><i></i><i></i><i></i></span><div class="tab">${mark}<span>Hermes Workbench · GitHub</span>${icon('close')}</div><div class="tab active">${mark}<span>Hermes Workbench</span>${icon('close')}</div><span class="new-tab">${icon('plus')}</span></div><div class="toolbar"><span class="controls">${icon('back')}${icon('forward')}${icon('reload')}</span>${icon('bookmark')}<div class="address">${icon('sliders')}<span>workbench.example<span class="url-path">/workspace</span></span>${icon('shield')}</div>${icon('tabs')}${icon('menu')}</div>`;
const mobileTop = `<div class="status"><span>9:41</span><span class="island"></span><span class="signal">▮▮▮ ${icon('battery')}</span></div><div class="toolbar mobile-toolbar"><div class="address">${icon('sliders')}<span>workbench.example</span>${icon('shield')}</div>${icon('tabs')}${icon('menu')}</div>`;
const mobileBottom = `<div class="mobile-bottom"><div class="actions">${icon('back')}${icon('forward')}${icon('plus')}${icon('share')}${icon('bookmark')}</div><div class="home"></div></div>`;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    for (const filename of fs.readdirSync(source).filter(name => name.endsWith('.png')).sort()) {
      const data = fs.readFileSync(path.join(source, filename));
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      const mobile = filename === 'workbench-mobile.png';
      const padding = mobile ? 36 : 48;
      const page = await browser.newPage({ viewport: { width: width + padding * 2, height: height + padding * 2 + (mobile ? 160 : 100) }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Hermes Workbench showcase</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:${padding}px;background:radial-gradient(ellipse at 10% 0%,#e6efec,transparent 65%),linear-gradient(135deg,#edf0ee,#cbdedc);font-family:-apple-system,BlinkMacSystemFont,"Arial",sans-serif;color:#d8e7e7}
.window{width:${width}px;border-radius:${mobile ? 32 : 18}px;overflow:hidden;background:#073d42;box-shadow:0 22px 42px #153c3d35,0 0 0 1px #24595b55}svg{width:20px;height:20px;flex-shrink:0}.tabstrip{height:48px;display:flex;align-items:center;gap:8px;padding:6px 16px 0;background:#06383d}.lights{display:flex;gap:9px;margin-right:24px;align-self:center;padding-bottom:6px}.lights i{width:13px;height:13px;border-radius:50%;background:#ff5f57}.lights i:nth-child(2){background:#febc2e}.lights i:nth-child(3){background:#28c840}
.tab{height:38px;width:260px;display:flex;gap:10px;align-items:center;padding:0 12px;border-radius:12px;color:#9bbdc0;font-size:13px}.tab.active{background:#08616a;color:#eef9f9}.tab>span:nth-child(2){flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tab svg{width:14px;height:14px}.mark{width:18px;height:18px;background:#a0b789;color:#263c2e;display:grid;place-items:center;font-size:11px;font-weight:700;border-radius:4px}.new-tab{display:flex;margin-left:8px}
.toolbar{height:52px;display:flex;align-items:center;gap:20px;padding:0 18px;background:#075c65;border-bottom:1px solid #286e72}.controls{display:flex;gap:20px}.controls svg:nth-child(2){opacity:.45}.address{height:36px;flex:1;display:flex;align-items:center;gap:15px;padding:0 14px;border-radius:20px;background:#10494f;font-size:14px;min-width:0}.address>span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.address svg{width:18px;height:18px}.url-path{color:#91b6b9}img{width:${width}px;height:${height}px;display:block}
.status{height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-size:13px;font-weight:600}.island{width:84px;height:22px;border-radius:15px;background:#06292d}.signal{display:flex;align-items:center;gap:4px;font-size:10px}.signal svg{width:23px;height:18px}.mobile-toolbar{height:54px;padding:0 12px;gap:12px}.mobile-toolbar .address{height:36px;padding:0 10px;gap:8px;font-size:13px}.mobile-toolbar>svg{width:19px;height:19px}.mobile-bottom{height:66px;background:#07535c}.actions{height:47px;display:flex;align-items:center;justify-content:space-between;padding:0 25px}.home{height:4px;width:110px;background:#c7dedf;border-radius:4px;margin:5px auto 0}
</style><div class="window">${mobile ? mobileTop : desktop}<img alt="Workbench sample interface" src="data:image/png;base64,${data.toString('base64')}">${mobile ? mobileBottom : ''}</div></html>`);
      await page.locator('img').evaluate(img => img.decode());
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Horizontal overflow: ${filename}`);
      await page.screenshot({ path: path.join(output, filename), fullPage: true });
      console.log(`${filename}: ${width} × ${height} content, ${mobile ? 'mobile' : 'macOS'} Brave/Chrome-style frame`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
