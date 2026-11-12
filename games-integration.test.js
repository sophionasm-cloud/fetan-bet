'use strict';

// Database-free checks for the customer-only game integrations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const games = require('./games');

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const gameServer = read('games.js');
const catalog = read('public/games.js');
const chicken = read('public/games/chicken-road-2/js/game.js');
const penalty = read('public/games/penalty/js/game.js');
const app = read('public/app.js');
const index = read('public/index.html');
const homeCss = read('public/home-v2.css');
const sharedShell = read('public/game-shell.js');
const immersiveCss = read('public/immersive-games.css');
const workspace = read('public/workspace.js');

assert.match(server, /const g = \(fn\) => \[auth, need\('customer'\), wrap/);
for (const route of [
  "app.get('/api/games/penalty'",
  "app.post('/api/games/penalty/start'",
  "app.post('/api/games/penalty/shoot'",
  "app.post('/api/games/penalty/cashout'",
]) assert.ok(server.includes(route), `customer route exists: ${route}`);

const lobbyCatalog = catalog.match(/const LOBBY_GAME_CATALOG = Object\.freeze\(\[([\s\S]*?)\n  \]\);/);
assert.ok(lobbyCatalog, 'customer lobby uses a scalable game catalog');
for (const game of ['chicken-road-2', 'star', 'roulette', 'mines', 'plinko', 'penalty', 'keno']) {
  const launchId = game === 'chicken-road-2' ? 'chicken-road-2' : game;
  assert.match(lobbyCatalog[1], new RegExp(`id: '${game}'.*status: 'available'.*gameUrl: '${launchId}'`),
    `${game} remains available through its existing launch reference`);
}
assert.match(lobbyCatalog[1], /id: 'chicken-road-2'.*name: 'Chicken Road Dash'/);
assert.match(lobbyCatalog[1], /id: 'penalty'.*name: 'Penalty Unlimited'/);
assert.doesNotMatch(lobbyCatalog[1], /id: 'bingo'/, 'retired Bingo is not in the customer lobby');
for (const category of ['crash', 'slots', 'roulette', 'table', 'live', 'more']) {
  assert.match(catalog, new RegExp(`id: '${category}'`), `${category} category is represented`);
}
assert.match(catalog, /status: 'coming_soon'/, 'future games are data-driven promotional entries');
for (const upcoming of ['aviator-coming', 'pharaoh-coming', 'royal-roulette-coming', 'blackjack-coming']) {
  assert.match(lobbyCatalog[1], new RegExp(`id: '${upcoming}'.*status: 'coming_soon'.*gameUrl: null`),
    `${upcoming} is a non-launchable Coming Soon entry`);
}
assert.match(catalog, /href="#\/game\/' \+ esc\(game\.gameUrl\)/, 'available game posters use their existing game launch references');
assert.match(catalog, /aria-label="' \+ \(lang === 'am' \? 'ይጫወቱ' : 'Play'\) \+ ' ' \+ esc\(game\.title\)/,
  'playable poster links have accessible names');
assert.match(catalog, /alt="' \+ esc\(game\.title\) \+ ' poster"/, 'game posters have descriptive alt text');
assert.match(catalog, /class="home-card-title"/, 'playable cards show their game names over the artwork');
assert.match(catalog, /class="home-live-pill"/, 'verified live counts have a compact poster badge');
assert.match(catalog, /Number\.isSafeInteger\(game\.livePlayerCount\)/, 'live counts render only from valid real count data');
assert.match(lobbyCatalog[1], /livePlayerCount: null/, 'no fabricated player counts are configured');
assert.match(catalog, /No live casino games are currently integrated/, 'empty live-casino section explains current availability');
assert.match(catalog, /data-view-category=/, 'category sections include View All actions');
assert.match(catalog, /clone\.setAttribute\('aria-hidden', 'true'\)[\s\S]*?clone\.setAttribute\('inert', ''\)[\s\S]*?clone\.querySelectorAll\('a, button, input, select, textarea'\)/,
  'infinite-loop visuals are inert and cannot create duplicate interactive links');
assert.match(catalog, /prefers-reduced-motion: reduce/);
assert.match(catalog, /scroller\.addEventListener\('pointerdown'/, 'carousel pauses while the user interacts');
assert.match(catalog, /scroller\.addEventListener\('pointerenter'/, 'carousel pauses on hover-capable devices');
assert.match(catalog, /scrollCarry \+= \(time - lastFrame\) \* 0\.014[\s\S]*?const wholePixels = Math\.trunc\(scrollCarry\)/,
  'carousel accumulates subpixel movement so its subtle autoplay advances in pixel-based scroll containers');
assert.match(catalog, /data-cat="\$\{esc\(filter\.id\)\}"/, 'category filters are populated from the catalog taxonomy');
assert.match(catalog, /data-scroll="prev"[\s\S]*?data-scroll="next"/, 'manual previous and next controls remain available');
assert.match(app, /function nav\(\)\s*\{\s*const n = \$\('nav'\);\s*if \(!me\)\s*\{\s*n\.hidden = true;/,
  'guests do not receive customer navigation destinations');
assert.match(homeCss, /#nav\.app-bottom-tabs\[hidden\]\s*\{\s*display:\s*none !important;/,
  'the fixed-navigation CSS respects the hidden state for guests');
assert.match(homeCss, /guest-mode[\s\S]*?#headerLoginBtn[\s\S]*?#headerRegBtn[\s\S]*?display:\s*inline-flex !important/,
  'guest Login and Register actions are directly visible in the header');
assert.match(app, /function mountPromoSlider\(app\)[\s\S]*?new Set\(\[\.\.\.app\.querySelectorAll\('\.home-game-card\[data-status="available"\]\[data-game\]'\)\]\.map/,
  'the illustrated promotion slider counts unique currently listed games');
for (const asset of ['daily-winning.svg', 'six-games.svg', 'fast-withdrawals.svg', 'registration-bonus.svg', 'game-collage.svg', 'game-tokens.svg']) {
  assert.ok(fs.statSync(path.join(root, 'public/images/promotions', asset)).size > 0, `existing campaign asset is available: ${asset}`);
}
assert.match(app, /Eligible new accounts receive a one-time reward[\s\S]*?active agent code/,
  'promo-credit copy keeps its existing eligibility condition');
assert.match(app, /Terms information is not available here yet[\s\S]*?Privacy information is not available here yet/,
  'missing legal documents are represented with clear safe copy rather than bracket placeholders');
assert.match(app, /licenseConfigured[\s\S]*?Licensed by \$\{esc\(licenseAuthority\)\}/,
  'unconfigured license placeholders are not published in the footer');
assert.doesNotMatch(read('public/site-config.js'), /supportHours:\s*'24\/7'/,
  'the public page does not claim unverified round-the-clock support');
assert.match(catalog, /frame\.src = `\/games\/\$\{game\}\/\?fetan=1&fetan-shell=1`/);
assert.match(index, /fetan-game-immersive/);
assert.match(app, /#\\\/game\\\/\(road\|road-dash\|chicken-road-2\|penalty\|mines\|plinko\|keno\|bingo\|roulette\|star\)/,
  'direct game routes include every game so the shared immersive shell can render them');
assert.match(app, /gameRoute\?\.\[1\] === 'bingo'[\s\S]*?bingoRouteState\?\.active/,
  'only users with an active Bingo round remain on the legacy game route');
for (const endpoint of ['/providers', '/deposits', '/transactions']) {
  assert.ok(sharedShell.includes(endpoint), `shared shell uses the existing ${endpoint} API`);
}
for (const rule of ['100dvh', 'safe-area-inset-bottom', 'overscroll-behavior: none']) {
  assert.ok(immersiveCss.includes(rule), `immersive layout supports ${rule}`);
}
assert.match(immersiveCss, /body\.game-open > #nav\.app-bottom-tabs\s*\{\s*display:\s*none !important;/,
  'immersive games hide the legacy customer bottom navigation');
assert.match(sharedShell, /id="immersive-deposit-receipt" data-deposit-receipt/,
  'deposit receipt upload has a wired change target');
assert.match(catalog, /gameReturnEntry/,
  'direct game URLs establish an in-app lobby entry for Back navigation');
assert.match(server, /app\.post\('\/api\/games\/bingo\/start',[\s\S]*?status\(410\)\.json\(\{ error: 'BINGO_RETIRED', message: 'Bingo has been retired\.'/);
assert.match(server, /app\.post\('\/api\/games\/bingo\/abandon',[\s\S]*?status\(410\)/);
assert.match(server, /app\.get\('\/api\/games\/bingo',[\s\S]*?app\.post\('\/api\/games\/bingo\/call'/,
  'active Bingo state and continuation endpoints remain registered');
assert.match(server, /app\.get\('\/api\/admin\/active-bingo-rounds',[\s\S]*?WHERE r\.game='bingo' AND r\.status='active'/,
  'the admin-only active round note is backed by a read-only active-round query');
assert.match(workspace, /async function superDashboard\(\)[\s\S]*?ctx\.api\('\/admin\/active-bingo-rounds'\)[\s\S]*?No active Bingo rounds remain/,
  'Super Admin sees the current active-round list and its zero-round state');
for (const asset of ['public/img/chicken-road-2-card.jpg', 'public/img/penalty-unlimited-preview.jpg']) {
  assert.ok(fs.statSync(path.join(root, asset)).size > 0, `poster exists: ${asset}`);
}
for (const game of ['chicken-road-2', 'penalty']) {
  const html = read(`public/games/${game}/index.html`);
  const bundle = read(`public/games/${game}/js/game.js`);
  if (game === 'chicken-road-2') {
    assert.match(html, /id="balance">Loading ETB…</, 'Chicken Road 2.0 loads the real wallet instead of flashing a demo balance');
    assert.match(html, /class="balance-pill" title="Fetan Bet wallet balance"/, 'the chicken game identifies the real wallet');
  } else {
    assert.match(html, /id="balance">Loading…</, `${game} does not flash a demo balance`);
    assert.match(html, /Fetan Bet wallet balance \(ETB\)/, `${game} identifies the wallet`);
  }
  assert.doesNotMatch(`${html}\n${bundle}`, /localhost:4173|127\.0\.0\.1:4173/);
  assert.match(bundle, /credentials:\s*'same-origin'/, `${game} sends the authenticated same-origin cookie`);
}

assert.match(chicken, /const realWalletMode = true/, 'Chicken Road 2.0 uses the real-wallet API');
assert.match(chicken, /lanes: 15[\s\S]*?multipliers: \[1\.01, 1\.06, 1\.15, 1\.24, 1\.35, 1\.48, 1\.65, 1\.85, 2\.12, 2\.47, 2\.96, 3\.70, 4\.64, 6\.50, 12\.08\]/, 'Easy shows the exact approved ladder');
assert.match(chicken, /lanes: 9[\s\S]*?multipliers: \[1\.18, 1\.83, 2\.95, 5\.02, 9\.04, 17\.74, 38\.71, 67\.34, 305\.94\]/, 'Medium shows the exact approved ladder');
assert.match(chicken, /multipliers: \[1\.44, 3\.45, 9\.09, 26\.78, 92\.54, 391\.25, 2235\.72, 18960\.33, 379632\.82\]/, 'Hard shows the exact approved ladder');
assert.doesNotMatch(`${chicken}\n${read('public/games/chicken-road-2/index.html')}`, /1\.5x|finish bonus|DEMO MODE|DEMO ETB|Reset demo balance/i,
  'customer UI has no demo balance or 1.5x completion bonus');
const chickenHtml = read('public/games/chicken-road-2/index.html');
assert.match(chickenHtml, /<a class="home-btn" href="\.\.\/" data-fetan-back[^>]*>[\s\S]*?Home<\/span>[\s\S]*?<\/a>\s*<a class="brand"/,
  'Home link appears before the existing game title');
assert.match(chicken, /querySelectorAll\('\[data-fetan-back\]'\)[\s\S]*?fetan-game-close/,
  'Home uses the existing parent Games-page navigation message');
assert.match(read('public/games/chicken-road-2/css/style.css'), /\.home-btn[\s\S]*?@media \(max-width: 400px\)[\s\S]*?\.home-btn/,
  'Home control has compact responsive styling');
assert.match(chicken, /SCHEMA_NOT_READY:[\s\S]*?required migration/,
  'missing game migration has a clear, persistent error message');
assert.match(chicken, /ENDPOINT_NOT_FOUND:[\s\S]*?Restart the server/,
  'a stale local server is distinguished from a balance loading state');
assert.match(chicken, /function laneLimit\(\) \{ return DIFFICULTY\[state\.difficulty\]\.lanes; \}/, 'each mode uses its approved playable level count');
assert.match(chicken, /function finishPosition\(\) \{ return laneLimit\(\) \+ 1; \}/, 'the finish sidewalk remains a separate final action');
assert.match(chicken, /fetanApi\(''\)\.then\(\(data\) => \{\s*useServerRound\(data\)/,
  'integrated game retrieves its server balance and active round');
assert.match(chicken, /fetanApi\('\/start', \{ bet_santim: Math\.round\(state\.bet \* 100\), difficulty: state\.difficulty, action_id: state\.pendingStartActionId \}\)/,
  'integrated round creation submits stake, difficulty and a start idempotency key');
assert.match(chicken, /fetanApi\('\/cross', \{ round_id: state\.serverRoundId, action_id: actionId \}\)/,
  'integrated crossing sends an idempotency key without a client outcome or timestamp');
assert.match(chicken, /fetanApi\('\/cashout', \{ round_id: state\.serverRoundId, action_id: actionId \}\)/,
  'integrated cash out submits only the round and idempotency key');
assert.match(chicken, /function checkCollision\(\)[\s\S]*?if \(integrated\) return;/,
  'integrated visual traffic cannot decide a crossing outcome');
assert.doesNotMatch(chicken, /\/api\/me/, 'Chicken Road 2.0 uses the game wallet endpoint rather than a local balance');
for (const route of [
  "app.get('/api/games/chicken-road-dash/demo'",
  "app.post('/api/games/chicken-road-dash/demo/start'",
  "app.post('/api/games/chicken-road-dash/demo/cross'",
  "app.post('/api/games/chicken-road-dash/demo/cashout'",
  "app.get('/api/games/chicken-road-dash/demo/verify/:roundId'",
]) assert.ok(server.includes(route), `Model C demo endpoint remains available as an offline fallback: ${route}`);
for (const route of [
  "app.get('/api/games/chicken-road-dash/real'",
  "app.post('/api/games/chicken-road-dash/real/start'",
  "app.post('/api/games/chicken-road-dash/real/cross'",
  "app.post('/api/games/chicken-road-dash/real/cashout'",
  "app.get('/api/games/chicken-road-dash/real/verify/:roundId'",
]) assert.ok(server.includes(route), `real-wallet endpoint exists: ${route}`);
const realService = read('chicken-road-real-service.js');
const chickenConfig = read('chicken-road-2-config.js');
assert.match(realService, /laneOutcomesV2/, 'real settlement uses the v2 committed-outcome protocol');
assert.match(realService, /merkleTreeV2/, 'real settlement uses Merkle commitments for the configured level count');
assert.match(realService, /payoutFor\(/, 'real settlement uses the shared integer-santim payout helper');
assert.doesNotMatch(realService, /ladder\[[^\]]+\]\s*\*\s*1\.5|finish_bonus|finishBonus/, 'real settlement has no completion bonus');
assert.match(realService, /postLedger|ledger\s*=\s*postLedger/, 'real settlement uses the existing wallet ledger');
assert.match(realService, /SELECT balance FROM wallets WHERE user_id=\$1 FOR UPDATE/, 'bet deduction locks the real wallet row');
assert.match(chickenConfig, /Medium[\s\S]*?probabilityLines: \[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21\]/, 'Medium stores the extra probability-only rows');
assert.match(chickenConfig, /cumulativeProbabilityPpb: \[[\s\S]*?30_000,\s*\]/, 'Medium keeps the exact probability-only precision');
assert.doesNotMatch(chickenConfig, /line: 19[\s\S]*?multiplier:/, 'Medium does not invent a multiplier for line 19');
const demoService = read('chicken-road-demo-service.js');
const demoMigration = read('migrations/005_chicken_road_dash_demo.sql');
assert.match(demoService, /FOR UPDATE OF r, b/, 'demo actions lock the user-owned round and isolated demo balance');
assert.match(demoService, /priorAction\(client, roundId, actionId, request\)/, 'demo actions persist and replay the exact prior response');
assert.doesNotMatch(demoService, /postLedger|game_rounds|wallets|ledger/, 'demo settlement is isolated from financial tables');
assert.match(demoService, /verifyProof[\s\S]*?merkle_proofs_valid/, 'completed demo rounds verify seed commitment and Merkle proofs');
assert.match(demoMigration, /CREATE TABLE IF NOT EXISTS chicken_road_dash_demo_rounds/);
assert.match(demoMigration, /CREATE TABLE IF NOT EXISTS chicken_road_dash_demo_actions/);
assert.match(demoMigration, /trg_chicken_road_dash_demo_commitment_immutable/);
assert.match(demoMigration, /trg_chicken_road_dash_demo_actions_immutable/);
assert.doesNotMatch(demoMigration, /CREATE TABLE IF NOT EXISTS game_rounds|ALTER TABLE wallets|CREATE TABLE IF NOT EXISTS ledger/,
  'demo migration is isolated from financial game rounds, wallets and ledger');
assert.match(chicken, /fetanApi\(`\/verify\/\$\{encodeURIComponent\(state\.serverRoundId\)\}`\)/,
  'integrated result screen can request completed round verification');
assert.match(chicken, /JSON\.stringify\(\{ bet: state\.bet, difficulty: state\.difficulty/,
  'integrated preferences persist locally while the authoritative balance loads from the wallet');
assert.doesNotMatch(chickenHtml, /DEMO MODE|cannot be withdrawn|Reset demo balance/, 'integrated page has no demo wallet copy');
assert.match(chickenHtml, /Chicken Road uses your Fetan Bet wallet/, 'integrated page explains real-wallet settlement');
assert.match(gameServer, /const PENALTY_MAX_BET = 50000[\s\S]*?async function penaltyStart[\s\S]*?if \(bet > PENALTY_MAX_BET\) throw new Error\('INVALID'\)/,
  'Penalty preserves its standalone 500 ETB maximum bet');
assert.match(penalty, /if \(data\.active && Number\.isSafeInteger\(serverBet\) && serverBet >= 100\)/,
  'an inactive server state does not replace the customer-selected initial stake with zero');
assert.match(penalty, /if \(data\.active && DIFFICULTY\[data\.difficulty\]\)/,
  'an inactive server state does not reset the customer-selected difficulty');
assert.match(penalty, /if \(integrated && state\.serverLadder\?\.\[index\] !== undefined\)/,
  'the integrated Penalty ladder displays server-provided multipliers');
assert.match(penalty, /state\.currentMult = Number\(state\.remoteResult\.multiplier\)/,
  'the integrated Penalty animation uses the confirmed server multiplier');
assert.match(penalty, /if \(integrated\) \{[\s\S]*?fetanApi\('\/start'/);
assert.match(penalty, /fetanApi\('\/shoot'/);
assert.match(penalty, /fetanApi\('\/cashout'/);
assert.match(gameServer, /async function penaltyStart[\s\S]*?withTx\(async \(client\) => \{[\s\S]*?SELECT balance FROM wallets WHERE user_id=\$1 FOR UPDATE/,
  'Penalty start debits through the existing locked wallet transaction');
assert.match(gameServer, /async function penaltyShoot[\s\S]*?SELECT \* FROM game_rounds WHERE user_id=\$1 AND game='penalty' AND status='active' FOR UPDATE/,
  'Penalty actions lock the active round');
assert.match(gameServer, /const saved = aim === cue\.dive/,
  'Penalty outcome is resolved from the server-generated keeper dive');
assert.match(gameServer, /async function penaltyCashout[\s\S]*?UPDATE game_rounds SET status='done', payout=\$1, detail=\$2 WHERE id=\$3 AND status='active' AND step=\$4[\s\S]*?postLedger\(\{ client, userId, delta: payout, type: 'win'/,
  'Penalty cashout conditionally settles once through the existing ledger');

// Server and UI share the version-3 difficulty-specific Penalty ladders.
const penaltyLadders = {
  easy: [0.33, 0.36, 0.40, 0.44, 0.48, 0.53],
  medium: [0.38, 0.48, 0.61, 0.77, 0.97, 1.23],
  hard: [0.45, 0.67, 1.00, 1.49, 2.22, 3.32],
};
for (const [difficulty, expected] of Object.entries(penaltyLadders)) {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, step) => Number(games.penaltyMultiplierCents(step + 1, difficulty, 3)) / 100),
    expected,
    `Penalty ${difficulty} version-3 ladder`
  );
}
assert.deepEqual(
  Array.from({ length: 6 }, (_, step) => Number(games.penaltyMultiplierCents(step, 'medium', 1))),
  [0, 180, 337, 632, 1186, 2224],
  'Penalty version 1 retains the legacy ladder'
);
assert.deepEqual(
  Array.from({ length: 6 }, (_, step) => Number(games.penaltyMultiplierCents(step, 'medium', 2))),
  [0, 180, 337, 632, 1186, 2224],
  'Penalty version 2 retains the legacy ladder'
);

const penaltyCaps = {
  easy: { 100: 353, 50000: 287 },
  medium: { 100: 141, 50000: 115 },
  hard: { 100: 83, 50000: 67 },
};
for (const [difficulty, caps] of Object.entries(penaltyCaps)) {
  for (const betCents of [100, 50000]) {
    const step = games.penaltyMaxSafeStep(betCents, difficulty, 3);
    assert.equal(step, caps[betCents], `Penalty ${difficulty} ${betCents} santim cap step`);
    const settled = BigInt(betCents) * games.penaltyMultiplierCents(step, difficulty, 3) / 100n;
    assert.ok(settled <= BigInt(Number.MAX_SAFE_INTEGER), `Penalty ${difficulty} ${betCents} santim payout fits safe integer`);
    assert.ok(BigInt(betCents) * games.penaltyMultiplierCents(step + 1, difficulty, 3) / 100n > BigInt(Number.MAX_SAFE_INTEGER),
      `Penalty ${difficulty} ${betCents} santim next step is safely blocked`);
  }
}

const { grossPayoutFromMultiplierCents } = require('./payout');
for (const source of [chicken, penalty]) {
  const match = source.match(/function grossPreviewBirr\(stakeBirr, multiplier\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'integrated gross payout preview uses integer santim');
  const preview = vm.runInNewContext(`(${match[0]})`);
  assert.equal(preview(1.01, 1.89), grossPayoutFromMultiplierCents(101, 189n) / 100,
    'preview rounds down exactly as server settlement does');
  assert.equal(preview(3, 3.37), grossPayoutFromMultiplierCents(300, 337n) / 100);
}

console.log('games-integration.test.js: customer game integration checks passed');
