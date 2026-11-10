'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  MODES,
  PROBABILITY_SCALE,
  conditionalSurvivalForLevel,
  percentFromPpb,
  payoutFor,
} = require('./chicken-road-2-config');

const EXACT = {
  easy: {
    lines: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29],
    multipliers: ['1.01', '1.06', '1.15', '1.24', '1.35', '1.48', '1.65', '1.85', '2.12', '2.47', '2.96', '3.70', '4.64', '6.50', '12.08'],
    probabilities: ['29.70%', '28.30%', '26.09%', '24.19%', '22.22%', '20.27%', '18.18%', '16.22%', '14.15%', '12.15%', '10.14%', '8.11%', '6.47%', '4.62%', '2.48%'],
  },
  medium: {
    lines: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    multipliers: ['1.18', '1.83', '2.95', '5.02', '9.04', '17.74', '38.71', '67.34', '305.94'],
    probabilities: ['25.42%', '16.39%', '10.17%', '5.98%', '3.32%', '1.69%', '0.78%', '0.31%', '0.10%'],
    extraProbabilities: ['0.02%', '0.003%'],
  },
  hard: {
    lines: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    multipliers: ['1.44', '3.45', '9.09', '26.78', '92.54', '391.25', '2235.72', '18960.33', '379632.82'],
    probabilities: ['20.83%', '8.70%', '3.30%', '1.12%', '0.32%', '0.077%', '0.013%', '0.0016%', '0.000079%'],
  },
};

for (const difficulty of ['easy', 'medium', 'hard']) {
  const mode = MODES[difficulty];
  const expected = EXACT[difficulty];
  assert.deepEqual(mode.lines, expected.lines);
  assert.deepEqual(mode.multipliers, expected.multipliers);
  assert.deepEqual(
    mode.cumulativeProbabilityPpb.slice(0, mode.lanes).map(percentFromPpb),
    expected.probabilities
  );
  assert.equal(mode.lanes, expected.lines.length);
  assert.equal(mode.multipliers.length, mode.lanes);
  assert.equal(mode.multiplierCents.length, mode.lanes);
  if (expected.extraProbabilities) {
    assert.deepEqual(
      mode.cumulativeProbabilityPpb.slice(mode.lanes).map(percentFromPpb),
      expected.extraProbabilities
    );
    assert.deepEqual(mode.probabilityLines.slice(mode.lanes), [19, 21]);
  }

  // The conditional survival product must reproduce the final cumulative
  // probability exactly (within integer ppb rounding).
  let previous = PROBABILITY_SCALE;
  for (let level = 1; level <= mode.lanes; level++) {
    const survival = conditionalSurvivalForLevel(difficulty, level);
    assert.equal(survival.denominator, previous);
    assert.equal(survival.numerator, mode.cumulativeProbabilityPpb[level - 1]);
    previous = survival.numerator;
  }
  assert.equal(previous, mode.cumulativeProbabilityPpb[mode.lanes - 1]);
}

// The approved table implies roughly 30% RTP per listed line; this is a
// reporting invariant, not a rule used to alter the approved values.
for (const difficulty of ['easy', 'medium', 'hard']) {
  const mode = MODES[difficulty];
  for (let level = 0; level < mode.lanes; level++) {
    const rtp = Number(mode.multipliers[level]) * mode.cumulativeProbabilityPpb[level] / PROBABILITY_SCALE * 100;
    assert.ok(rtp > 20.8 && rtp <= 30.7, `${difficulty} level ${level + 1} RTP ${rtp}`);
  }
}

assert.equal(payoutFor(10000, MODES.easy.multiplierCents[0]), 10100);
assert.equal(payoutFor(100, MODES.hard.multiplierCents[8]), 37963282);
assert.equal(payoutFor(999, MODES.hard.multiplierCents[8]), 379253187);

// Customer-only immersive shell and account UI are deliberately kept in the
// Chicken Road package plus a route-scoped parent layout flag.
const source = (file) => readFileSync(resolve(__dirname, file), 'utf8');
const parentHtml = source('public/index.html');
const appJs = source('public/app.js');
const gamesJs = source('public/games.js');
const gameHtml = source('public/games/chicken-road-2/index.html');
const gameCss = source('public/games/chicken-road-2/css/style.css');
const gameJs = source('public/games/chicken-road-2/js/game.js');
const parentCss = source('public/games.css');
assert.ok(parentHtml.indexOf("location.hash)) document.documentElement.classList.add('chicken-road-immersive')") < parentHtml.indexOf('<link rel="stylesheet" href="style.css">'));
assert.match(appJs, /window\.setFetanChickenImmersive\(Boolean\(gameRoute && gameRoute\[1\] === 'chicken-road-2'\)\)/);
assert.match(appJs, /navigateCustomer: \(nextTab\)/);
assert.match(appJs, /road-dash\|chicken-road-2\|mines/);
assert.match(gamesJs, /document\.documentElement\.classList\.add\('chicken-road-immersive'\)/);
assert.match(gamesJs, /event\.origin !== location\.origin \|\| event\.source !== frame\.contentWindow/);
assert.match(parentCss, /html\.chicken-road-immersive body > :not\(#app\)/);
assert.match(parentCss, /html\.chicken-road-immersive body\.game-open > #nav\.app-bottom-tabs\s*\{\s*display:\s*none !important;/,
  'the shared mobile-game navigation cannot override Chicken Road immersive mode');
assert.match(appJs, /wasImmersive && document\.fullscreenElement/,
  'leaving the immersive route exits a fullscreen game container');
assert.match(gameHtml, /id="walletSheet"/);
assert.match(gameHtml, /id="depositSheet"/);
assert.match(gameHtml, /id="lowBalanceNote"/);
assert.match(gameCss, /height: 100dvh/);
assert.match(gameCss, /env\(safe-area-inset-bottom\)/);
assert.match(gameJs, /fetch\(path,\s*\{[\s\S]*credentials: 'same-origin'/);
assert.match(gameJs, /customerAccountApi\('\/api\/providers'\)/);
assert.match(gameJs, /customerAccountApi\('\/api\/transactions'\)/);
assert.match(gameJs, /customerAccountApi\('\/api\/deposits', payload\)/);
assert.match(gameJs, /payload\.receipt_data = depositReceiptData/);
assert.match(gameHtml, /A round is in progress/);
assert.match(gameJs, /activeAccountSheet\) return/);
assert.match(gameJs, /refreshAuthoritativeBalance\(\)\.catch/);

console.log('chicken-road-2-config.test.js: exact tables, cumulative probabilities and payout rules passed');
