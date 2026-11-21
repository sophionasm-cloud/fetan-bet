'use strict';

const config = require('../public/games/slot/js/slot-config');
const math = require('../public/games/slot/js/slot-math');

function seededByte(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 24;
  };
}

function simulate(spins = config.SIMULATION_SPINS, seed = config.SIMULATION_SEED) {
  if (!Number.isSafeInteger(spins) || spins <= 0 || !Number.isSafeInteger(seed)) throw new Error('INVALID_SIMULATION_INPUT');
  const next = seededByte(seed);
  const bet = config.DEFAULT_BET_SANTIM;
  const totalBet = spins * bet;
  let totalPayout = 0;
  let hits = 0;
  const maxMatchCount = { three: 0, four: 0, five: 0 };
  let multipleLines = 0;
  const payoutBands = { noWin: 0, under5x: 0, '5xToUnder15x': 0, '15xToUnder50x': 0, atLeast50x: 0 };
  const stops = Array(config.REEL_COUNT);

  for (let spin = 0; spin < spins; spin++) {
    for (let reel = 0; reel < stops.length; reel++) stops[reel] = next();
    const result = math.evaluateStops(stops, bet);
    totalPayout += result.totalPayout;
    if (!result.wins.length) {
      payoutBands.noWin++;
      continue;
    }
    hits++;
    if (result.wins.length > 1) multipleLines++;
    const maxCount = Math.max(...result.wins.map((win) => win.count));
    maxMatchCount[maxCount === 3 ? 'three' : maxCount === 4 ? 'four' : 'five']++;
    const multiple = result.totalPayout / bet;
    if (multiple < 5) payoutBands.under5x++;
    else if (multiple < 15) payoutBands['5xToUnder15x']++;
    else if (multiple < 50) payoutBands['15xToUnder50x']++;
    else payoutBands.atLeast50x++;
  }

  return {
    spins,
    seed,
    totalBetSantim: totalBet,
    totalPayoutSantim: totalPayout,
    rtpPercent: totalPayout / totalBet * 100,
    hitRatePercent: hits / spins * 100,
    distribution: { noWin: spins - hits, maxMatchCount, multipleLines, payoutBands },
  };
}

if (require.main === module) {
  const result = simulate(process.argv[2] == null ? config.SIMULATION_SPINS : Number(process.argv[2]));
  const percent = (value) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
  console.log(JSON.stringify({ ...result, rtpPercent: percent(result.rtpPercent), hitRatePercent: percent(result.hitRatePercent) }, null, 2));
}

module.exports = { simulate };
