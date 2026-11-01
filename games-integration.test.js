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

assert.match(server, /const g = \(fn\) => \[auth, need\('customer'\), wrap/);
for (const route of [
  "app.get('/api/games/penalty'",
  "app.post('/api/games/penalty/start'",
  "app.post('/api/games/penalty/shoot'",
  "app.post('/api/games/penalty/cashout'",
]) assert.ok(server.includes(route), `customer route exists: ${route}`);

assert.match(catalog, /data-g="chicken-road-2"[\s\S]*?Chicken Road Dash/);
assert.match(catalog, /data-g="penalty"[\s\S]*?Penalty Unlimited/);
assert.match(catalog, /frame\.src = `\/games\/\$\{game\}\/\?fetan=1`/);
for (const asset of ['public/img/chicken-road-2-card.png', 'public/img/penalty-unlimited-preview.png']) {
  assert.ok(fs.statSync(path.join(root, asset)).size > 0, `poster exists: ${asset}`);
}
for (const game of ['chicken-road-2', 'penalty']) {
  const html = read(`public/games/${game}/index.html`);
  const bundle = read(`public/games/${game}/js/game.js`);
  if (game === 'chicken-road-2') {
    assert.match(html, /id="balance">1 000 000\.00 DEMO ETB</, 'Chicken Road Dash starts with a labeled demo balance');
  } else {
    assert.match(html, /id="balance">Loading…</, `${game} does not flash a demo balance`);
    assert.match(html, /Fetan Bet wallet balance \(ETB\)/, `${game} identifies the wallet`);
  }
  assert.doesNotMatch(`${html}\n${bundle}`, /localhost:4173|127\.0\.0\.1:4173/);
  assert.match(bundle, /credentials:\s*'same-origin'/, `${game} sends the authenticated same-origin cookie`);
}

assert.match(chicken, /const realWalletMode = false/, 'real wallet mode remains disabled');
assert.match(chicken, /function laneLimit\(\) \{ return LANES; \}/, 'demo retains all 14 traffic lanes');
assert.match(chicken, /function finishPosition\(\) \{ return laneLimit\(\) \+ 1; \}/, 'demo retains the finish sidewalk and bonus crossing');
assert.match(chicken, /function startRound\(\)[\s\S]*?if \(integrated && realWalletMode\) \{[\s\S]*?state\.balance = round2\(state\.balance - state\.bet\)/,
  'integrated demo starts using only its local demo balance');
assert.match(chicken, /function checkCollision\(\)[\s\S]*?if \(integrated && realWalletMode\) return;/,
  'demo collision decisions remain in the local gameplay simulation');
assert.match(chicken, /if \(integrated && realWalletMode\) \{\s*fetch\('\/api\/me'/,
  'demo mode never requests the real wallet balance');
assert.match(chicken.slice(chicken.indexOf('function init()')), /if \(integrated && realWalletMode\) \{[\s\S]*?fetch\('\/api\/me'/,
  'wallet lookup is reachable only in the explicitly disabled real-wallet mode');
assert.match(chicken, /JSON\.stringify\(\{ balance: state\.balance, bet: state\.bet, difficulty: state\.difficulty/,
  'demo balance and preferences persist locally');
assert.match(read('public/games/chicken-road-2/index.html'), /DEMO MODE[\s\S]*?cannot be withdrawn|Demo balance only/, 'integrated page labels demo funds as nonwithdrawable');
assert.match(read('public/games/chicken-road-2/css/style.css'), /html\.fetan-integrated #menuReset \{ display: initial/,
  'integrated demo keeps its isolated reset control available');
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

// Server and UI share the standalone Penalty ladder values and recurrence.
assert.deepEqual(
  Array.from({ length: 6 }, (_, step) => Number(games.penaltyMultiplierCents(step))),
  [0, 180, 337, 632, 1186, 2224]
);
let previous = 2224n;
for (let step = 6; step <= 24; step++) {
  previous = (previous * 1875n + 500n) / 1000n;
  assert.equal(games.penaltyMultiplierCents(step), previous, `Penalty ladder step ${step}`);
}

for (const betCents of [100, 50000]) {
  const step = games.penaltyMaxSafeStep(betCents);
  const settled = BigInt(betCents) * games.penaltyMultiplierCents(step) / 100n;
  assert.ok(settled <= BigInt(Number.MAX_SAFE_INTEGER), `Penalty ${betCents} santim payout fits safe integer`);
  assert.ok(BigInt(betCents) * games.penaltyMultiplierCents(step + 1) / 100n > BigInt(Number.MAX_SAFE_INTEGER),
    `Penalty ${betCents} santim next step is safely blocked`);
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
