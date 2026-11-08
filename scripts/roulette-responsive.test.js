'use strict';

// Responsive UI test + screenshots for the Roulette game at the required
// viewports. Registers a test user, then opens the game in a fresh browser
// context per viewport (so responsive/JS state does not leak between sizes).
//
// Asserts:
//  - the page and game body do not scroll (the whole game fits one screen);
//  - no horizontal overflow on the page, the game body or the number board;
//  - every key control is visible and inside the game viewport, above the
//    fixed bottom navigation on phones/tablets;
//  - exactly one wallet/deposit affordance is shown (game topbar), with the
//    duplicate global wallet/deposit and the roulette account strip hidden;
//  - no console errors or failed same-origin requests.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve(__dirname, '..', 'test-results', 'roulette-responsive');
// Ethiopian mobile number: 07 or 09 + 8 digits
const PHONE = '0' + [7, 9][Math.floor(Math.random() * 2)] + Math.floor(10000000 + Math.random() * 90000000).toString().padStart(8, '0');

const VIEWPORTS = [
  { label: 'mobile-320x720', width: 320, height: 720 },
  { label: 'mobile-390x844', width: 390, height: 844 },
  { label: 'mobile-430x932', width: 430, height: 932 },
  { label: 'tablet-portrait-768x1024', width: 768, height: 1024 },
  { label: 'tablet-landscape-1024x768', width: 1024, height: 768 },
  { label: 'laptop-1366x768', width: 1366, height: 768 },
  { label: 'desktop-1920x1080', width: 1920, height: 1080 },
];

const failures = [];
const consoleErrors = [];
const failedResponses = [];

function assert(cond, label) {
  if (!cond) failures.push(label);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });

  try {
  // --- Register a test user once, then reuse the auth state per viewport ---
  const boot = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const bootPage = await boot.newPage();
  const reg = await bootPage.request.post(`${BASE}/api/register`, {
    data: { name: 'Responsive Tester', phone: PHONE, password: 'password123', lang: 'en' },
  });
  if (!reg.ok()) {
    const lg = await bootPage.request.post(`${BASE}/api/login`, {
      data: { phone: PHONE, password: 'password123' },
    });
    if (!lg.ok()) throw new Error(`Register/login failed: reg=${reg.status()} login=${lg.status()}`);
  }
  const storageState = await boot.storageState();
  await boot.close();

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      storageState,
    });
    // Remote Google Fonts and the Telegram SDK can stall headless page loads
    // in restricted networks; the app works without both, so block them for
    // deterministic screenshots and assertions.
    await context.route(/^https?:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
    await context.route(/^https?:\/\/telegram\.org\//, (route) => route.abort());
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('Failed to load resource') && !m.text().includes('/favicon')) {
        consoleErrors.push(`${vp.label}: ${m.text()}`);
      }
    });
    page.on('response', (r) => {
      if (r.url().startsWith(BASE) && r.status() >= 400 && !r.url().includes('/favicon')) {
        failedResponses.push(`${vp.label}: ${r.status()} ${r.url()}`);
      }
    });

    await page.goto(`${BASE}/#/game/roulette`, { waitUntil: 'domcontentloaded' });
    // The shell is display:contents on desktop (no box of its own), so wait
    // for it to be attached and for the actual game body / board to render.
    await page.waitForSelector('.mobile-game-shell[data-game="roulette"]', { state: 'attached', timeout: 30000 });
    await page.waitForSelector('#gbody', { state: 'visible', timeout: 30000 });
    await page.waitForSelector('#rtab button', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(700);

    const m = await page.evaluate(() => {
      const el = (sel) => document.querySelector(sel);
      const rect = (sel) => {
        const node = el(sel);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height };
      };
      const isVisible = (sel) => {
        const node = el(sel);
        if (!node) return false;
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const gbody = el('#gbody');
      const nav = el('#nav');
      const topbar = el('.mobile-game-topbar');
      const rtableWrap = el('.rtable-wrap');
      const rtable = el('#rtab');
      const numberButtons = rtable ? Array.from(rtable.querySelectorAll('[data-k="number"]:not(.zero)')) : [];
      const outsideButtons = el('#rout') ? Array.from(el('#rout').querySelectorAll('button:not(:disabled)')) : [];
      const outsideRect = rect('#rout');
      const outsideVisible = outsideButtons.every((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const everythingWithin = (sel, box) => {
        const r = rect(sel);
        if (!r || !box) return false;
        return r.t >= box.t - 1 && r.b <= box.b + 1;
      };
      const gbodyRect = gbody ? gbody.getBoundingClientRect() : null;
      const navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const controls = ['#rgo', '#rbet .chips', '#rbet .betrow', '#rbet input', '.roulette-bet-tools', '#rtab', '#rout', '#rpick', '#wheel', '.history'];
      return {
        vw: innerWidth,
        vh: innerHeight,
        page: {
          sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          sh: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
          cw: document.documentElement.clientWidth,
        },
        gbody: gbody ? {
          rect: { t: gbodyRect.top, b: gbodyRect.bottom, h: gbodyRect.height, w: gbodyRect.width },
          sh: gbody.scrollHeight,
          ch: gbody.clientHeight,
          sw: gbody.scrollWidth,
          cw: gbody.clientWidth,
        } : null,
        nav: navRect ? { t: navRect.top, b: navRect.bottom, h: navRect.height, position: getComputedStyle(nav).position } : null,
        topbar: { visible: isVisible('.mobile-game-topbar'), rect: rect('.mobile-game-topbar'), display: topbar ? getComputedStyle(topbar).display : null },
        balance: {
          topbarVisible: isVisible('#mobile-game-balance'),
          text: el('#mobile-game-balance') ? el('#mobile-game-balance').textContent.trim() : null,
          globalHidden: el('#balanceBox') ? el('#balanceBox').hidden : null,
          quickDepositHidden: el('#quickDepositBtn') ? el('#quickDepositBtn').hidden : null,
          accountStripDisplay: el('.roulette-account-strip') ? getComputedStyle(el('.roulette-account-strip')).display : null,
        },
        backButton: isVisible('.mobile-game-icon'),
        globalTop: el('.top') ? { display: getComputedStyle(el('.top')).display, hidden: el('.top').hidden } : null,
        title: el('.mobile-game-title') ? el('.mobile-game-title').textContent.trim() : null,
        wheel: rect('#wheel'),
        history: rect('.history'),
        board: {
          wrapW: rtableWrap ? rtableWrap.clientWidth : null,
          wrapSW: rtableWrap ? rtableWrap.scrollWidth : null,
          tableW: rtable ? rtable.getBoundingClientRect().width : null,
          tableSW: rtable ? rtable.scrollWidth : null,
          numberCount: numberButtons.length,
          numbersAllVisible: numberButtons.every((b) => {
            const r = b.getBoundingClientRect();
            const wr = rtableWrap.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.left >= wr.left - 1 && r.right <= wr.right + 1;
          }),
        },
        outside: { visible: outsideVisible, count: outsideButtons.length, rect: outsideRect },
        controls: controls.reduce((acc, sel) => {
          acc[sel] = { visible: isVisible(sel), rect: rect(sel), withinGbody: gbodyRect ? everythingWithin(sel, { t: gbodyRect.top, b: gbodyRect.bottom }) : false };
          return acc;
        }, {}),
      };
    });

    const label = vp.label;
    if (vp.width <= 1024) {
      assert(m.globalTop && (m.globalTop.hidden === true || m.globalTop.display === 'none'), `${label}: global page header should be hidden in game view`);
    }
    assert(m.page.sw <= m.page.cw + 1, `${label}: page horizontal overflow (${m.page.sw}/${m.page.cw})`);
    assert(m.page.sh <= m.vh + 1, `${label}: page scrolls vertically (${m.page.sh}/${m.vh})`);
    assert(!!m.gbody, `${label}: missing #gbody`);
    if (m.gbody) {
      assert(m.gbody.sh <= m.gbody.ch + 1, `${label}: game body scrolls vertically (${m.gbody.sh}/${m.gbody.ch})`);
      assert(m.gbody.sw <= m.gbody.cw + 1, `${label}: game body horizontal overflow (${m.gbody.sw}/${m.gbody.cw})`);
      assert(m.gbody.rect.t >= 0 && m.gbody.rect.b <= m.vh + 1, `${label}: game body outside viewport`);
      if (m.nav && m.nav.position === 'fixed') assert(m.gbody.rect.b <= m.nav.t + 1, `${label}: game body is covered by bottom nav (${m.gbody.rect.b}/${m.nav.t})`);
    }

    assert(m.topbar.visible, `${label}: game topbar not visible`);
    assert(m.balance.topbarVisible, `${label}: topbar wallet not visible`);
    assert(!!m.balance.text && m.balance.text.length > 0, `${label}: topbar wallet value is empty`);
    assert(m.balance.globalHidden === true, `${label}: duplicate global wallet balance should be hidden`);
    assert(m.balance.quickDepositHidden === true, `${label}: duplicate global deposit button should be hidden`);
    assert(m.balance.accountStripDisplay === 'none', `${label}: duplicate roulette account strip should be hidden`);
    assert(m.backButton, `${label}: back button not visible`);
    assert(!!m.title, `${label}: game title missing`);

    assert(m.wheel && m.wheel.w >= 150 && m.wheel.h >= 150, `${label}: wheel too small (${m.wheel ? Math.round(m.wheel.w) : 0}px)`);
    assert(m.history && m.history.h > 0, `${label}: recent results not visible`);
    assert(m.board.numberCount === 36, `${label}: expected 36 number cells, got ${m.board.numberCount}`);
    assert(m.board.numbersAllVisible, `${label}: number board overflows horizontally (${m.board.tableSW}/${m.board.wrapSW})`);
    assert(m.board.wrapSW <= m.board.wrapW + 1, `${label}: board wrapper overflows (${m.board.wrapSW}/${m.board.wrapW})`);
    assert(m.outside.visible && m.outside.count === 4, `${label}: supported outside bets not visible`);

    for (const [sel, info] of Object.entries(m.controls)) {
      assert(info.visible, `${label}: control not visible: ${sel}`);
      assert(info.withinGbody, `${label}: control outside game body: ${sel}`);
      if (info.rect) {
        assert(info.rect.t >= -1 && info.rect.b <= m.vh + 1, `${label}: control outside viewport: ${sel}`);
      }
    }
    if (m.nav && m.nav.position === 'fixed') {
      const bet = m.controls['#rgo'];
      assert(bet && bet.rect.b <= m.nav.t + 1, `${label}: Bet button below / behind bottom nav (${bet ? bet.rect.b : 'n/a'}/${m.nav.t})`);
      assert(m.nav.b >= m.vh - 2, `${label}: bottom nav is not fixed to the bottom (${m.nav.b}/${m.vh})`);
    }

    const shotPath = path.join(OUT, `${label}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    if (label === 'desktop-1920x1080') {
      fs.copyFileSync(shotPath, path.join(OUT, 'desktop-final.png'));
    }
    await context.close();
  }

  } finally {
    await browser.close().catch(() => {});
  }

  if (consoleErrors.length) failures.push(`Console errors: ${consoleErrors.join(' | ')}`);
  if (failedResponses.length) failures.push(`Failed responses: ${failedResponses.join(' | ')}`);

  const report = {
    viewports: VIEWPORTS.map((v) => v.label),
    screenshotsDir: OUT,
    consoleErrors,
    failedResponses,
    failures,
    passed: failures.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
