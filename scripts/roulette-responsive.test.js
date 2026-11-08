'use strict';

// Responsive UI screenshots for the Roulette game at the required viewports.
// Registers a test user, logs in, navigates to #/game/roulette, and captures
// screenshots at mobile, tablet, and desktop sizes. Also asserts there is no
// horizontal overflow, no duplicate wallet/deposit header, and key controls
// remain visible.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:3000';
const OUT = path.resolve(__dirname, '..', 'test-results', 'roulette-responsive');
// Ethiopian mobile number: 07 or 09 + 8 digits
const PHONE = '0' + [7,9][Math.floor(Math.random()*2)] + Math.floor(10000000 + Math.random() * 90000000).toString().padStart(8,'0');

const VIEWPORTS = [
  { label: 'mobile-320x720', width: 320, height: 720 },
  { label: 'mobile-390x844', width: 390, height: 844 },
  { label: 'mobile-430x932', width: 430, height: 932 },
  { label: 'tablet-portrait-768x1024', width: 768, height: 1024 },
  { label: 'tablet-landscape-1024x768', width: 1024, height: 768 },
  { label: 'laptop-1366x768', width: 1366, height: 768 },
  { label: 'desktop-1920x1080', width: 1920, height: 1080 },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedResponses = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource') && !m.text().includes('/favicon')) consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400 && !r.url().includes('/favicon')) failedResponses.push({ status: r.status(), path: r.url() }); });
  // --- Register a test user (this also sets the auth token cookie) ---
  const reg = await page.request.post(`${BASE}/api/register`, {
    data: { name: 'Responsive Tester', phone: PHONE, password: 'password123', lang: 'en' },
  });
  if (!reg.ok()) {
    // Try login in case user already exists
    const lg = await page.request.post(`${BASE}/api/login`, {
      data: { phone: PHONE, password: 'password123' },
    });
    if (!lg.ok()) {
      throw new Error(`Register/login failed: reg=${reg.status()} login=${lg.status()}`);
    }
  }

  // --- Navigate to the Roulette game ---
  await page.goto(`${BASE}/#/game/roulette`, { waitUntil: 'domcontentloaded' });

  // Wait for the game shell to render
  await page.waitForSelector('.mobile-game-shell[data-game="roulette"]', { timeout: 30000 });

  let failures = [];

  function assert(cond, label) {
    if (!cond) failures.push(label);
  }

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);

    await page.screenshot({
      path: path.join(OUT, `${vp.label}.png`),
      fullPage: true,
    });

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const shell = document.querySelector('.mobile-game-shell[data-game="roulette"]');
      const top = document.querySelector('.top');
      const balanceBox = document.getElementById('balanceBox');
      const quickDeposit = document.getElementById('quickDepositBtn');
      const rgo = document.getElementById('rgo');
      const chips = document.querySelector('.chips');
      const betPanel = document.querySelector('.roulette-bet-panel');
      const wheel = document.getElementById('wheel');
      const hist = document.querySelector('.history');
      const nav = document.querySelector('#nav.app-bottom-tabs');
      return {
        scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
        clientWidth: doc.clientWidth,
        shellRect: shell ? shell.getBoundingClientRect() : null,
        topHidden: top ? top.hidden || getComputedStyle(top).display === 'none' : null,
        balanceBoxHidden: balanceBox ? balanceBox.hidden : null,
        quickDepositHidden: quickDeposit ? quickDeposit.hidden : null,
        rgoVisible: rgo ? rgo.offsetWidth > 0 && rgo.offsetHeight > 0 : null,
        chipsVisible: chips ? chips.offsetWidth > 0 && chips.offsetHeight > 0 : null,
        betPanelVisible: betPanel ? betPanel.offsetWidth > 0 && betPanel.offsetHeight > 0 : null,
        wheelVisible: wheel ? wheel.offsetWidth > 0 && wheel.offsetHeight > 0 : null,
        histVisible: hist ? hist.offsetWidth > 0 && hist.offsetHeight > 0 : null,
        navVisible: nav ? nav.offsetWidth > 0 && nav.offsetHeight > 0 : null,
        gameHeaderBalance: !!document.querySelector('#roulette-account-value'),
        gameHeaderDeposit: !!document.querySelector('#roulette-deposit-button'),
      };
    });

    assert(metrics.scrollWidth <= metrics.clientWidth + 2, `${vp.label}: horizontal overflow (${metrics.scrollWidth}/${metrics.clientWidth})`);
    const isMobile = vp.width <= 1024;
    if (isMobile) {
      assert(metrics.topHidden !== false, `${vp.label}: global top header should be hidden in game view`);
    }
    assert(metrics.balanceBoxHidden === true, `${vp.label}: duplicate global wallet balance should be hidden`);
    assert(metrics.quickDepositHidden === true, `${vp.label}: duplicate global deposit button should be hidden`);
    assert(metrics.rgoVisible === true, `${vp.label}: Bet button not visible`);
    assert(metrics.chipsVisible === true, `${vp.label}: chip selector not visible`);
    assert(metrics.betPanelVisible === true, `${vp.label}: betting panel not visible`);
    assert(metrics.wheelVisible === true, `${vp.label}: wheel not visible`);
    assert(metrics.histVisible === true, `${vp.label}: recent results not visible`);
    assert(metrics.gameHeaderBalance === true, `${vp.label}: game header wallet balance missing`);
    assert(metrics.gameHeaderDeposit === true, `${vp.label}: game header deposit button missing`);
  }

  // Final desktop screenshot for the report
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'desktop-final.png'), fullPage: true });

  await browser.close();

  if (consoleErrors.length) {
    failures.push(`Console errors: ${consoleErrors.join(' | ')}`);
  }
  if (failedResponses.length) {
    failures.push(`Failed responses: ${JSON.stringify(failedResponses)}`);
  }

  console.log(JSON.stringify({
    viewports: VIEWPORTS.map(v => v.label),
    screenshotsDir: OUT,
    consoleErrors,
    failedResponses,
    failures,
    passed: failures.length === 0,
  }, null, 2));

  if (failures.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
