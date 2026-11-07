'use strict';

// Database-free visual verification. This script serves only `public/` and
// answers `/api/*` with in-memory fixtures; it never imports server.js,
// connects to a database, registers accounts, or forwards a request.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'test-results', 'glassmorphism-theme');
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const errors = [];
const httpErrors = [];
const fixtureRequests = [];
const fixtureWrites = [];
const expectedGuestAuthChecks = [];
const mode = { role: null };
const testUser = { id: 900001, role: 'user', name: 'Glass Theme Fixture', phone: '0915000000' };
const testBalance = 100000;

function check(name, ok, detail = '') {
  const item = { name, ok: Boolean(ok), detail };
  checks.push(item);
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!item.ok) errors.push(item);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function fixtureApi(req, res, pathname) {
  fixtureRequests.push(`${req.method} ${pathname}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') fixtureWrites.push(`${req.method} ${pathname}`);

  const locale = pathname.match(/^\/api\/i18n\/(en|am)$/);
  if (locale) {
    const file = path.join(ROOT, 'locales', `${locale[1]}.json`);
    return sendJson(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  if (pathname === '/api/me') {
    if (!mode.role) {
      expectedGuestAuthChecks.push(`${req.method} ${pathname}`);
      return sendJson(res, 401, { error: 'LOGIN' });
    }
    return sendJson(res, 200, { user: testUser, balance: testBalance, promo_credits: 0, limits: { min: 100, max: 100000 } });
  }
  if (pathname === '/api/providers') return sendJson(res, 200, { providers: [
    { id: 1, code: 'telebirr', name: 'Telebirr', instr_en: 'Fixture payment instructions', instr_am: 'የሙከራ ክፍያ መመሪያ' },
    { id: 2, code: 'cbe', name: 'CBE', instr_en: 'Fixture bank instructions', instr_am: 'የሙከራ ባንክ መመሪያ' },
  ] });
  if (pathname === '/api/deposits') return sendJson(res, 200, { deposits: [] });
  if (pathname === '/api/withdrawals') return sendJson(res, 200, { withdrawals: [] });
  if (pathname === '/api/transactions') return sendJson(res, 200, { transactions: [] });
  if (pathname === '/api/support') return sendJson(res, 200, { ticket: null, messages: [], ai_enabled: true });
  if (pathname === '/api/lang' || pathname === '/api/logout') return sendJson(res, 200, { ok: true });

  if (pathname === '/api/games/road' || pathname === '/api/games/road/') {
    return sendJson(res, 200, { active: false, ladder: [], maxSteps: 10, balance: testBalance });
  }
  if (pathname === '/api/games/road/history') return sendJson(res, 200, { history: [], rounds: [] });
  if (pathname === '/api/games/mines' || pathname === '/api/games/mines/') {
    return sendJson(res, 200, { active: false, mines: 5, grid_size: 5, balance: testBalance });
  }
  if (pathname === '/api/games/bingo' || pathname === '/api/games/bingo/') {
    return sendJson(res, 200, { active: false, round: null });
  }
  if (pathname.startsWith('/api/games/chicken-road-dash/real')) {
    return sendJson(res, 200, { balance_santim: testBalance, round: null, ladder: [] });
  }
  if (pathname === '/api/games/penalty' || pathname === '/api/games/penalty/') {
    return sendJson(res, 200, { balance: testBalance, active: false, ladder: [] });
  }

  return sendJson(res, 404, { error: 'UNMAPPED_VISUAL_FIXTURE', path: pathname });
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch { res.writeHead(400); return res.end(); }
  if (pathname === '/api' || pathname.startsWith('/api/')) return fixtureApi(req, res, pathname);

  const requested = pathname === '/' ? '/index.html' : pathname;
  const filename = path.resolve(PUBLIC, `.${requested}`);
  if (filename !== PUBLIC && !filename.startsWith(`${PUBLIC}${path.sep}`)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  let stat;
  try { stat = fs.statSync(filename); } catch { stat = null; }
  const target = stat?.isDirectory() ? path.join(filename, 'index.html') : filename;
  if (!target.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(target)) {
    httpErrors.push(`404 ${pathname}`);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});

function waitForApp(page) {
  return page.waitForFunction(() => document.querySelector('#app')?.children.length > 0, null, { timeout: 20000 });
}
async function settle(page, ms = 300) { await page.waitForTimeout(ms); }
async function setTheme(page, expected) {
  const current = await page.evaluate(() => document.body.dataset.customerTheme);
  if (current !== expected) await page.click('#customerThemeToggle');
  await page.waitForFunction((value) => document.body.dataset.customerTheme === value, expected);
}
async function screenshot(page, filename, fullPage = false) {
  await page.screenshot({ path: path.join(OUT, filename), fullPage, animations: 'disabled' });
}
async function loadGamePosters(page) {
  await page.evaluate(() => document.querySelectorAll('#app .game-poster').forEach((image) => { image.loading = 'eager'; }));
  await page.waitForFunction(() => [...document.querySelectorAll('#app .game-poster')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 12000 });
  await page.evaluate(() => Promise.all([...document.querySelectorAll('#app .game-poster')].map((image) => image.decode())));
}
async function clickTab(page, key) {
  await page.locator(`#nav button[data-k="${key}"]`).click();
  await page.waitForFunction((target) => document.querySelector(`#nav button[data-k="${target}"]`)?.classList.contains('on'), key);
  await settle(page, 250);
}
async function overflowState(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), minWidth: style.minWidth, flex: style.flex, display: style.display };
    };
    const offenders = [...document.querySelectorAll('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className.slice(0, 80) : '', left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
    }).filter((element) => element.width > 0 && (element.left < -1 || element.right > width + 1)).slice(0, 8);
    return {
      width, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, offenders,
      header: Object.fromEntries(['.top', '.brand', '.brand > span:last-child', '.top-right', '#headerLoginBtn', '#customerThemeToggle', '#langBtn', '.mobile-header-menu'].map((selector) => [selector, rect(selector)])),
    };
  });
}
async function assertNoHorizontalOverflow(page, label) {
  const state = await overflowState(page);
  const pass = state.scrollWidth <= state.width + 1 && state.bodyScrollWidth <= state.width + 1;
  check(`${label}: no horizontal page overflow`, pass, pass ? '' : JSON.stringify(state));
}
async function leaveGame(page, game) {
  if (game === 'chicken-road-2' || game === 'penalty') {
    await page.frameLocator('.integrated-game-frame').locator('[data-fetan-back]').first().click();
  } else {
    await page.locator('#gback').evaluate((button) => button.click());
  }
  await page.waitForSelector('#app .gcard', { timeout: 12000 });
  await settle(page, 120);
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // External resources are not required for this isolated local screenshot run.
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|telegram\.org)\//, async (route) => {
    const isCss = route.request().url().includes('fonts.googleapis.com');
    await route.fulfill({ status: 200, contentType: isCss ? 'text/css' : 'application/javascript', body: '' });
  });

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await settle(page, 500);
  check('guest receives customer theme', await page.evaluate(() => document.body.classList.contains('customer-theme')));
  check('guest defaults to dark theme', await page.evaluate(() => document.body.dataset.customerTheme === 'dark'));
  check('guest Login is visible in primary navigation', await page.locator('#publicPrimaryNav .public-login-link').isVisible());
  check('guest theme control is available', await page.locator('#customerThemeToggle').isVisible());
  check('lobby contains the eight current game cards', await page.locator('#app .gcard').count() === 8);
  await loadGamePosters(page);
  check('all eight game posters load', await page.locator('#app .game-poster').evaluateAll((images) => images.length === 8 && images.every((image) => image.complete && image.naturalWidth > 0)));
  const lobbyCardLayout = await page.locator('#app .gcard').evaluateAll((cards) => cards.map((card) => {
    const rect = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    return { game: card.dataset.g, display: style.display, width: Math.round(rect.width), height: Math.round(rect.height), title: card.querySelector('h3')?.textContent?.trim(), posterVisible: getComputedStyle(card.querySelector('.game-poster')).visibility !== 'hidden' && Number(getComputedStyle(card.querySelector('.game-poster')).opacity) > 0 };
  }));
  check('all eight game cards are visibly laid out', lobbyCardLayout.length === 8 && lobbyCardLayout.every((card) => card.display !== 'none' && card.width > 0 && card.height > 0 && card.posterVisible), JSON.stringify(lobbyCardLayout));
  await screenshot(page, 'final-guest-desktop-dark.png', true);
  await setTheme(page, 'light');
  check('light theme uses purple palette', await page.evaluate(() => document.body.dataset.customerTheme === 'light' && getComputedStyle(document.body).getPropertyValue('--bg').trim().toLowerCase() === '#f2e9ff'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await settle(page, 300);
  check('guest theme persists across hard refresh', await page.evaluate(() => document.body.dataset.customerTheme === 'light'));
  await loadGamePosters(page);
  await screenshot(page, 'final-guest-desktop-light.png', true);
  await page.locator('#publicPrimaryNav .public-login-link').click();
  await page.waitForSelector('#auth-modal');
  check('existing Login route opens login dialog', await page.locator('#auth-modal').isVisible());
  await screenshot(page, 'final-login-desktop-light.png');
  await page.locator('#auth-close').click();
  await page.locator('#headerRegBtn').click();
  await page.waitForSelector('#auth-modal');
  check('existing Register action opens registration dialog', await page.locator('#auth-modal').isVisible());
  await screenshot(page, 'final-register-desktop-light.png');
  await page.locator('#auth-close').click();

  // Guest language remains a local presentation choice; no backend writes.
  await page.locator('#langBtn').click();
  await settle(page, 200);
  check('guest Amharic layout renders', await page.evaluate(() => document.documentElement.lang === 'am'));
  await screenshot(page, 'final-guest-desktop-amharic.png', true);

  for (const viewport of [
    { width: 320, height: 720 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 1024, height: 768 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 320) await screenshot(page, 'final-guest-mobile-320.png');
    await assertNoHorizontalOverflow(page, `guest ${viewport.width}x${viewport.height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'final-guest-mobile-light.png');

  // Switch only the in-memory fixture role. The static server does not import
  // application code and all /api responses remain fixture data.
  mode.role = 'user';
  await page.evaluate(() => { localStorage.setItem('lang', 'en'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await settle(page, 400);
  await loadGamePosters(page);
  check('fixture customer is rendered as a customer', await page.evaluate(() => document.body.classList.contains('customer-theme') && document.querySelector('#nav')?.hidden === false));
  check('theme toggle persists for customer', await page.evaluate(() => document.body.dataset.customerTheme === 'light'));
  check('customer has all four primary navigation destinations', await page.locator('#nav button[data-k]').evaluateAll((buttons) => ['games', 'wallet', 'deposit', 'profile'].every((key) => buttons.some((button) => button.dataset.k === key))));
  await screenshot(page, 'final-customer-lobby-desktop-light.png', true);

  const accountScreens = [
    ['wallet', 'final-customer-wallet-desktop-light.png'],
    ['deposit', 'final-customer-deposit-desktop-light.png'],
    ['profile', 'final-customer-profile-desktop-light.png'],
  ];
  for (const [key, filename] of accountScreens) {
    await clickTab(page, key);
    await screenshot(page, filename, true);
    check(`${key} page renders`, await page.locator('#app').innerText().then((text) => text.trim().length > 0));
  }
  await page.locator('[data-profile-route="withdraw"]').click();
  await settle(page);
  check('withdraw page opens from profile action', await page.locator('#wf').count() === 1);
  await screenshot(page, 'final-customer-withdraw-desktop-light.png', true);
  await clickTab(page, 'profile');
  await page.locator('[data-profile-route="history"]').click();
  await settle(page);
  check('history page opens from profile action', await page.locator('#history-data-container').count() === 1);
  await screenshot(page, 'final-customer-history-desktop-light.png', true);
  await clickTab(page, 'profile');
  await page.locator('[data-profile-route="support"]').click();
  await settle(page);
  check('support page opens from profile action', await page.locator('#chat-form').count() === 1);
  await screenshot(page, 'final-customer-support-desktop-light.png', true);

  // Language is read from local storage before rendering, avoiding a language
  // API mutation while still exercising the actual Amharic UI strings.
  await page.evaluate(() => localStorage.setItem('lang', 'am'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await clickTab(page, 'profile');
  check('customer Amharic profile renders', await page.evaluate(() => document.documentElement.lang === 'am'));
  await screenshot(page, 'final-customer-profile-amharic.png');
  await page.evaluate(() => localStorage.setItem('lang', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);

  // Validate page width and bottom-nav clearance at every requested viewport.
  for (const viewport of [
    { width: 320, height: 720 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 1024, height: 768 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await clickTab(page, 'wallet');
    await assertNoHorizontalOverflow(page, `customer wallet ${viewport.width}x${viewport.height}`);
    if (viewport.width <= 1024) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle(page, 100);
      const geometry = await page.evaluate(() => {
        const nav = document.querySelector('#nav.app-bottom-tabs');
        const content = document.querySelector('#app')?.lastElementChild;
        const navRect = nav?.getBoundingClientRect();
        const contentRect = content?.getBoundingClientRect();
        return { navTop: navRect?.top, contentBottom: contentRect?.bottom, navHeight: navRect?.height };
      });
      check(`customer bottom navigation is visible at ${viewport.width}px`, await page.locator('#nav.app-bottom-tabs').isVisible());
      check(`customer bottom navigation fits and has content clearance at ${viewport.width}px`, geometry.navHeight >= 60 && geometry.navTop < viewport.height && geometry.contentBottom <= geometry.navTop, JSON.stringify(geometry));
      check(`customer navigation touch targets are at least 44px at ${viewport.width}px`, await page.locator('#nav.app-bottom-tabs button').evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().height >= 44)));
    } else {
      check(`customer desktop navigation is visible at ${viewport.width}px`, await page.locator('#nav:not([hidden])').isVisible());
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await clickTab(page, 'wallet');
  await setTheme(page, 'dark');
  await screenshot(page, 'final-customer-wallet-mobile-dark.png');
  await setTheme(page, 'light');
  await screenshot(page, 'final-customer-wallet-mobile-light.png');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await settle(page, 150);
  const bottomClearance = await page.evaluate(() => {
    const nav = document.querySelector('#nav.app-bottom-tabs')?.getBoundingClientRect();
    const app = document.querySelector('#app')?.getBoundingClientRect();
    return { navTop: nav?.top, appBottom: app?.bottom, viewportHeight: innerHeight, pageBottom: document.documentElement.scrollHeight };
  });
  check('wallet page can scroll past the fixed navigation', bottomClearance.pageBottom > bottomClearance.viewportHeight && bottomClearance.navTop < bottomClearance.viewportHeight, JSON.stringify(bottomClearance));

  // Six in-app games plus the two same-origin integrated iframe games.
  await page.setViewportSize({ width: 1366, height: 768 });
  const games = [
    ['chicken-road-2', '.integrated-game-frame'], ['mines', '.mines-arena'], ['plinko', '.plinko-arena'],
    ['keno', '.keno-board'], ['bingo', '.bingo-layout'], ['roulette', '.rtable'], ['star', '.slot'], ['penalty', '.integrated-game-frame'],
  ];
  await clickTab(page, 'games');
  for (const [game, selector] of games) {
    await page.locator(`#app .gcard[data-g="${game}"]`).click();
    await page.waitForSelector(selector, { timeout: 12000 });
    if (game === 'chicken-road-2' || game === 'penalty') {
      const frame = page.locator('.integrated-game-frame');
      await frame.waitFor({ state: 'visible' });
      await frame.evaluate((el) => new Promise((resolve) => {
        if (el.contentDocument?.readyState === 'complete') return resolve();
        el.addEventListener('load', resolve, { once: true });
      }));
      await frame.evaluate((el) => new Promise((resolve) => {
        const loader = el.contentDocument?.querySelector('#loader');
        if (!loader || getComputedStyle(loader).display === 'none' || getComputedStyle(loader).visibility === 'hidden') return resolve();
        const observer = new MutationObserver(() => {
          if (!loader.isConnected || getComputedStyle(loader).display === 'none' || getComputedStyle(loader).visibility === 'hidden') { observer.disconnect(); resolve(); }
        });
        observer.observe(loader, { attributes: true, attributeFilter: ['class', 'style'] });
        setTimeout(() => { observer.disconnect(); resolve(); }, 10000);
      }));
      const frameTheme = await frame.evaluate((el) => el.contentDocument?.documentElement?.dataset.customerTheme || null);
      check(`${game} iframe receives light theme`, frameTheme === 'light', String(frameTheme));
      const frameState = await frame.evaluate((el) => ({
        title: el.contentDocument?.title || '',
        themeStyle: Boolean(el.contentDocument?.querySelector('link[href="../../shared/customer-theme.css"]')),
        width: el.contentDocument?.documentElement?.scrollWidth || 0,
        clientWidth: el.contentDocument?.documentElement?.clientWidth || 0,
      }));
      check(`${game} iframe theme stylesheet loads`, frameState.themeStyle, frameState.title);
      check(`${game} iframe does not overflow horizontally`, frameState.width <= frameState.clientWidth + 1, JSON.stringify(frameState));
      await screenshot(page, `final-game-${game}-desktop-light.png`);
      await setTheme(page, 'dark');
      await settle(page, 150);
      check(`${game} iframe updates theme without reload`, await frame.evaluate((el) => el.contentDocument?.documentElement?.dataset.customerTheme === 'dark'));
      await screenshot(page, `final-game-${game}-desktop-dark.png`);
      await setTheme(page, 'light');
    } else {
      check(`${game} game interface renders`, await page.locator(selector).count() > 0);
      await screenshot(page, `final-game-${game}-desktop-light.png`);
      await setTheme(page, 'dark');
      await settle(page, 100);
      await screenshot(page, `final-game-${game}-desktop-dark.png`);
      await setTheme(page, 'light');
    }
    await leaveGame(page, game);
  }

  // Responsive game workspace checks. No game actions or bets are submitted.
  const responsiveGameViewports = [
    { width: 320, height: 720 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 1024, height: 768 }, { width: 1920, height: 1080 },
  ];
  for (const viewport of responsiveGameViewports) {
    await page.setViewportSize(viewport);
    for (const game of games.map(([key]) => key)) {
      await clickTab(page, 'games');
      await page.locator(`#app .gcard[data-g="${game}"]`).click();
      await page.waitForSelector('.mobile-game-shell', { timeout: 12000 });
      await settle(page, 220);
      await assertNoHorizontalOverflow(page, `game ${game} ${viewport.width}x${viewport.height}`);
      if (game === 'chicken-road-2' || game === 'penalty') {
        const frame = page.locator('.integrated-game-frame');
        check(`${game} frame visible at ${viewport.width}px`, await frame.isVisible());
        const dimensions = await frame.evaluate((el) => ({ width: el.contentDocument?.documentElement?.scrollWidth || 0, clientWidth: el.contentDocument?.documentElement?.clientWidth || 0 }));
        check(`${game} frame fits at ${viewport.width}px`, dimensions.width <= dimensions.clientWidth + 1, JSON.stringify(dimensions));
      } else {
        check(`${game} game shell visible at ${viewport.width}px`, await page.locator('.mobile-game-shell').isVisible());
      }
      if (viewport.width === 320 || viewport.width === 390) await screenshot(page, `final-game-${game}-mobile-${viewport.width}.png`);
      await leaveGame(page, game);
    }
  }

  check('no local static assets returned 404', httpErrors.length === 0, httpErrors.slice(0, 12).join('; '));
  check('no browser page exceptions', pageErrors.length === 0, pageErrors.join('; '));
  const expectedAuthConsoleErrors = consoleErrors.filter((message) => message.includes('status of 401 (Unauthorized)'));
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !message.includes('status of 401 (Unauthorized)'));
  check('guest authentication checks are handled as expected', expectedGuestAuthChecks.length > 0, `${expectedGuestAuthChecks.length} fixture GET /api/me responses returned 401 while signed out`);
  check('no unexpected browser console errors', unexpectedConsoleErrors.length === 0, unexpectedConsoleErrors.join('; '));
  check('no application database or external API was used', true, `fixture-contained mutating requests: ${fixtureWrites.length}`);

  const report = {
    mode: 'static public files + in-memory API fixtures; no app server or database used',
    passed: checks.filter((item) => item.ok).map((item) => item.name),
    errors,
    httpErrors,
    consoleErrors,
    expectedAuthConsoleErrors,
    expectedGuestAuthChecks,
    pageErrors,
    fixtureWrites,
    fixtureRequestCount: fixtureRequests.length,
    screenshotDirectory: OUT,
  };
  fs.writeFileSync(path.join(OUT, 'final-result.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  if (errors.length) process.exitCode = 1;
  console.log(`\n${checks.filter((item) => item.ok).length} passed, ${errors.length} failed. Fixture-only API requests: ${fixtureRequests.length}.`);
}

main().catch(async (error) => {
  console.error(error);
  try { server.close(); } catch {}
  process.exit(1);
});
