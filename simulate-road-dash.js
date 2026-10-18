// Simulation script for Road Dash (Chicken Crossing)
// Simulates 100,000 rounds per difficulty to measure:
// 1. Measured RTP (Push to end & Target cashout)
// 2. Survival rate to the last lane
// 3. Median lanes crossed

const crypto = require('crypto');
const { ROAD_CONFIG } = require('./games');

const ROUNDS_PER_DIFF = 100000;
const BET = 100; // 1 credit

function getLaneCrashChance(diff, lane) {
  const cfg = ROAD_CONFIG.difficulties[diff];
  return Math.min(0.99, cfg.p0 + cfg.step * (lane - 1));
}

function getLadder(diff) {
  const cfg = ROAD_CONFIG.difficulties[diff];
  let prod = 1;
  const ladder = [];
  for (let i = 1; i <= cfg.lanes; i++) {
    const pi = getLaneCrashChance(diff, i);
    prod *= (1 - pi);
    const m = Math.max(1.01, Math.floor((ROAD_CONFIG.rtp / prod) * 100) / 100);
    ladder.push(m);
  }
  return ladder;
}

function simulateDifficulty(diff) {
  const cfg = ROAD_CONFIG.difficulties[diff];
  const ladder = getLadder(diff);
  const lanesCount = cfg.lanes;

  let totalBetAllOut = 0;
  let totalWonAllOut = 0;

  // Let's also track a balanced cashout strategy: cashout at median target (e.g. 3 steps)
  const targetStep = Math.min(3, lanesCount);
  let totalBetTarget = 0;
  let totalWonTarget = 0;

  let survivedLastLane = 0;
  const lanesCrossedList = new Uint8Array(ROUNDS_PER_DIFF);

  console.log(`\n==================================================`);
  console.log(`Simulating ${ROUNDS_PER_DIFF.toLocaleString()} rounds for Difficulty: ${diff.toUpperCase()} (${lanesCount} lanes)`);
  console.log(`Config: p0 = ${cfg.p0}, step = ${cfg.step}, target RTP = ${ROAD_CONFIG.rtp * 100}%`);
  console.log(`Ladder Start: ${ladder[0]}x ... Last Lane Multiplier: ${ladder[lanesCount - 1]}x`);
  console.log(`--------------------------------------------------`);

  const t0 = Date.now();

  for (let i = 0; i < ROUNDS_PER_DIFF; i++) {
    const serverSeed = crypto.randomBytes(16).toString('hex');
    const clientSeed = 'sim_client_seed';

    totalBetAllOut += BET;
    totalBetTarget += BET;

    let clearedLanes = 0;
    let crashed = false;

    for (let lane = 1; lane <= lanesCount; lane++) {
      const pi = getLaneCrashChance(diff, lane);
      const msg = `${serverSeed}:${clientSeed}:${lane}`;
      const hash = crypto.createHash('sha256').update(msg).digest();
      const val = hash.readUInt32BE(0) / 0x100000000;

      if (val < pi) {
        crashed = true;
        break;
      }
      clearedLanes++;
    }

    lanesCrossedList[i] = clearedLanes;

    // Strategy 1: Push all the way to final lane
    if (!crashed && clearedLanes === lanesCount) {
      survivedLastLane++;
      totalWonAllOut += Math.floor(BET * ladder[lanesCount - 1]);
    }

    // Strategy 2: Cash out at targetStep
    if (clearedLanes >= targetStep) {
      totalWonTarget += Math.floor(BET * ladder[targetStep - 1]);
    }
  }

  const durationSec = ((Date.now() - t0) / 1000).toFixed(2);

  // Compute median lanes crossed
  const sorted = Array.from(lanesCrossedList).sort((a, b) => a - b);
  const medianLanes = sorted[Math.floor(sorted.length / 2)];
  const avgLanes = (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2);

  const survivalRate = ((survivedLastLane / ROUNDS_PER_DIFF) * 100).toFixed(4);
  const rtpAllOut = ((totalWonAllOut / totalBetAllOut) * 100).toFixed(2);
  const rtpTarget = ((totalWonTarget / totalBetTarget) * 100).toFixed(2);

  console.log(`Completed in: ${durationSec}s`);
  console.log(`Survival Rate to Last Lane: ${survivalRate}% (${survivedLastLane} / ${ROUNDS_PER_DIFF})`);
  console.log(`Median Lanes Crossed:       ${medianLanes}`);
  console.log(`Average Lanes Crossed:      ${avgLanes}`);
  console.log(`Measured RTP (Push to End): ${rtpAllOut}%`);
  console.log(`Measured RTP (Cashout @ ${targetStep}): ${rtpTarget}%`);
}

function run() {
  console.log(`Starting Road Dash Monte Carlo Simulation (Provably Fair PRNG)...`);
  for (const diff of Object.keys(ROAD_CONFIG.difficulties)) {
    simulateDifficulty(diff);
  }
  console.log(`\n==================================================`);
  console.log(`All simulations finished successfully.`);
}

if (require.main === module) {
  run();
}

module.exports = { simulateDifficulty };
