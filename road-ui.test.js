'use strict';

// Database-free structural regression checks for Road Dash result UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('public/games.js', 'utf8');
const css = fs.readFileSync('public/games.css', 'utf8');
const en = JSON.parse(fs.readFileSync('locales/en.json', 'utf8'));
const am = JSON.parse(fs.readFileSync('locales/am.json', 'utf8'));
const resultModal = source.match(/function showRoadResult\([\s\S]*?\n    function showRulesModal\(/)?.[0];
assert.ok(resultModal, 'Road Dash has a dedicated result modal renderer');
assert.match(resultModal, /resultShownForRound === roadRoundSerial/,
  'a completed Road Dash round can show only one result modal');
assert.match(resultModal, /t\('road_result_win'\).*C\.fmt\(net\)/,
  'confirmed wins show formatted net winnings');
assert.match(resultModal, /t\('road_result_gross'\).*C\.fmt\(gross\)/,
  'the result distinguishes gross payout from net winnings');
assert.match(resultModal, /t\('road_result_crashed'\)/);
assert.match(resultModal, /t\('road_result_try_again'\)/);
for (const key of ['road_result_win', 'road_result_crashed', 'road_result_congrats', 'road_result_try_again',
  'road_result_refund', 'road_result_refund_note', 'road_result_lost_stake', 'road_result_gross',
  'road_result_net_loss', 'road_result_complete', 'road_result_complete_note']) {
  assert.ok(en[key] && am[key], `Road Dash result text is translated: ${key}`);
}
assert.match(resultModal, /role="dialog" aria-modal="true"/);
assert.match(resultModal, /road-result-close/);
assert.match(resultModal, /event\.key === 'Escape'/);

const stepAction = source.match(/async function doStep\(\) \{[\s\S]*?\/\/ CASHOUT ACTION/)?.[0];
const cashoutAction = source.match(/async function doCashout\(\) \{[\s\S]*?\n    \}\n\n    \$\('rgo-btn'\)/)?.[0];
assert.ok(stepAction && cashoutAction, 'Road Dash step and cashout handlers are present');
assert.match(stepAction, /await C\.api\('\/games\/road\/step', \{\}\)[\s\S]*?if \(r\.crashed\)[\s\S]*?showRoadResult\('crash', r, st\.bet\)/,
  'crash modal follows the confirmed server step response');
assert.match(stepAction, /r\.finished[\s\S]*?showRoadResult\('complete', r, st\.bet\)/,
  'finish modal follows the confirmed server step response');
assert.match(cashoutAction, /await C\.api\('\/games\/road\/cashout', \{\}\)[\s\S]*?showRoadResult\('cashout', r, st\.bet\)/,
  'cashout modal follows the confirmed server response');
for (const handler of [stepAction, cashoutAction]) {
  const catchBlock = handler.slice(handler.lastIndexOf('} catch (e) {'));
  assert.match(catchBlock, /C\.fail\(e\)/, 'network errors use the existing error path');
  assert.doesNotMatch(catchBlock, /showRoadResult\(/, 'network errors never appear as game losses');
}
assert.doesNotMatch(source, /say\(\$\('rmsg'\), `[^`]*server_seed/,
  'raw server seed details are not printed in the Road Dash gameplay message');
assert.match(source, /window\.verifyRoadRound/,
  'fairness verification remains available in the existing feature');
for (const id of ['chip-1', 'chip-2', 'chip-5', 'chip-10']) {
  assert.match(source, new RegExp(`id="${id}" type="button">\\d+<`),
    `${id} quick bet chip has no redundant coin icon`);
}
assert.match(css, /\.road-result-card\.is-win/);
assert.match(css, /\.road-result-card\.is-loss/);
assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.road-actions-row[\s\S]*?flex-direction: row/,
  'Road Dash action buttons remain compact and side by side on phones');
assert.match(css, /\.road-sidewalk-start::after/);
assert.match(css, /\.chicken-hero::before/);

console.log('road-ui.test.js: Road Dash result and responsive UI checks passed');
