'use strict';

const crypto = require('node:crypto');
const { CONFIG, LANES, makeTraffic, crossingCollision, multiplier } = require('./chicken-road-engine');

function runOne(difficulty, strategy, target, betCents) {
  const seed = crypto.randomBytes(32);
  const traffic = makeTraffic(seed, difficulty);
  const rng = () => crypto.randomInt(0, 0x100000000) / 0x100000000;
  let elapsed = 0;
  let reached = 0;
  for (let lane = 1; lane <= LANES; lane++) {
    if (strategy === 'fixed-wait-0.5s') elapsed += 0.5;
    if (strategy === 'random-wait-0-2s') elapsed += rng() * 2;
    if (strategy.startsWith('safe-window-')) {
      const latest = strategy.startsWith('safe-window-latest-');
      const limit = Number(strategy.slice(latest ? 'safe-window-latest-'.length : 'safe-window-'.length, -1));
      let found = false;
      let selectedDelay = limit;
      for (let delay = 0; delay <= limit; delay += 0.05) {
        if (!crossingCollision(traffic, lane, elapsed + delay, difficulty)) {
          selectedDelay = delay;
          found = true;
          if (!latest) break;
        }
      }
      // Candidate bounded-window policy: when no safe instant is found before
      // the public deadline, the crossing is forced at the deadline.
      elapsed += found ? selectedDelay : limit;
    }
    const hit = crossingCollision(traffic, lane, elapsed, difficulty);
    elapsed += CONFIG[difficulty].hopTime;
    if (hit) return { payout: 0, reached, outcome: 'collision', cashout: false, finish: false };
    reached = lane;
    if (target === lane) {
      const mult = multiplier(difficulty, lane);
      return { payout: Math.round(betCents * mult), reached, outcome: 'cashout', cashout: true, finish: false };
    }
  }
  const payout = target === 'finish' ? Math.round(betCents * multiplier(difficulty, LANES) * 1.5) : 0;
  return { payout, reached, outcome: target === 'finish' ? 'finish' : 'cashout', cashout: target !== 'finish', finish: target === 'finish' };
}

function wilson(successes, n) {
  const z = 1.96, p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const radius = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / denom;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function simulate({ rounds = 5000, strategies = ['immediate', 'fixed-wait-0.5s', 'random-wait-0-2s', 'safe-window-0.25s', 'safe-window-0.5s', 'safe-window-1s', 'safe-window-3s'], bets = [100, 300, 50000] } = {}) {
  const rows = [];
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const strategy of strategies) {
      for (const target of [3, 7, 14, 'finish']) {
        for (const bet of bets) {
          let payoutSum = 0, payoutSq = 0, collisions = 0, cashouts = 0, finishes = 0, reachedSum = 0;
          let maxPayout = 0;
          for (let i = 0; i < rounds; i++) {
            const result = runOne(difficulty, strategy, target, bet);
            payoutSum += result.payout;
            payoutSq += result.payout * result.payout;
            collisions += result.outcome === 'collision' ? 1 : 0;
            cashouts += result.cashout ? 1 : 0;
            finishes += result.finish ? 1 : 0;
            reachedSum += result.reached;
            maxPayout = Math.max(maxPayout, result.payout);
          }
          const mean = payoutSum / rounds;
          const variance = Math.max(0, payoutSq / rounds - mean * mean);
          const se = Math.sqrt(variance / rounds);
          rows.push({ difficulty, strategy, target, bet_santim: bet, rounds, rtp: mean / bet, rtp_ci95_normal: [Math.max(0, mean - 1.96 * se) / bet, (mean + 1.96 * se) / bet], house_edge: 1 - mean / bet, collision_rate: collisions / rounds, collision_rate_ci95_wilson: wilson(collisions, rounds), cashout_rate: cashouts / rounds, finish_rate: finishes / rounds, average_crossings: reachedSum / rounds, average_payout_santim: mean, observed_max_payout_santim: maxPayout });
        }
      }
    }
  }
  return rows;
}

if (require.main === module) {
  const rounds = Math.max(100, Number(process.argv[2]) || 5000);
  process.stdout.write(JSON.stringify(simulate({ rounds }), null, 2) + '\n');
}

module.exports = { runOne, simulate };
