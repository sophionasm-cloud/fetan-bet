'use strict';
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
const PHONE = '0' + [7, 9][Math.floor(Math.random() * 2)] + Math.floor(10000000 + Math.random() * 90000000);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const boot = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const bp = await boot.newPage();
    const reg = await bp.request.post(`${BASE}/api/register`, { data: { name: 'Mines Probe', phone: PHONE, password: 'password123', lang: 'en' } });
    if (!reg.ok()) throw new Error('register failed: ' + reg.status());
    const state = await boot.storageState();
    await boot.close();

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: state });
    await ctx.route(/^https?:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
    await ctx.route(/^https?:\/\/telegram\.org\//, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/game/mines`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#mgrid .mine-tile', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(600);
    console.log(JSON.stringify(await page.evaluate(() => {
      const sels = ['#app', '.mobile-game-shell', '.mobile-game-topbar', '.stage', '#gbody', '.mines-arena', '.mines-main-area', '.mines-top-strip', '.mines-live-stats', '.mines-board-container', '#mgrid', '.mines-sidebar', '#mbet', '.mines-mobile-sticky-bar', '#nav'];
      const out = {};
      for (const sel of sels) {
        const n = document.querySelector(sel);
        if (!n) { out[sel] = null; continue; }
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        out[sel] = { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), w: +r.width.toFixed(1), display: cs.display, order: cs.order, position: cs.position, overflow: cs.overflow, bg: cs.backgroundColor, radius: cs.borderRadius };
      }
      out.stats = Array.from(document.querySelectorAll('.mines-live-stats .stat-item')).map((n) => ({ label: n.querySelector('.stat-title')?.textContent.trim(), value: n.querySelector('.stat-val')?.textContent.trim(), id: n.querySelector('.stat-val')?.id }));
      out.bodyClass = document.body.className;
      out.vh = innerHeight;
      return out;
    }), null, 1));
    await page.screenshot({ path: 'test-results/mines-probe/before-390.png' });
    await ctx.close();
  } finally { await browser.close().catch(() => {}); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
