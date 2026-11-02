'use strict';
const crypto = require('node:crypto');
const { CONFIG, LANES, makeTraffic, crossingCollision, multiplier } = require('./chicken-road-engine');
const { issueOpportunity } = require('./chicken-road-opportunity');

const LATENCY = Object.freeze({ very_fast: 0.01, normal: 0.05, slow: 0.20, high: 0.45, delayed: 0.85 });

function chooseArrival({ traffic, lane, openedAt, expiresAt, difficulty, policy, latency, rng }) {
  const desired = (delay) => openedAt + delay + latency;
  if (policy === 'immediate') return desired(0);
  if (policy === 'fixed-delay') return desired(0.25);
  if (policy === 'random-delay') return desired(rng() * 1.5);
  const latest = policy === 'adaptive-latest';
  let selected = null;
  for (let t = openedAt; t <= expiresAt; t += 0.05) {
    const arrival = t + latency;
    if (arrival > expiresAt) break;
    if (!crossingCollision(traffic, lane, arrival, difficulty)) {
      selected = arrival;
      if (!latest) break;
    }
  }
  // An action delayed beyond expiry is too late; the opportunity resolves at
  // expiry, exactly as it is shown to the customer.
  return selected;
}

function runRound({ difficulty, strategy, target, latency, windowSeconds, betCents }) {
  const seed = crypto.randomBytes(32);
  const traffic = makeTraffic(seed, difficulty);
  const random = crypto.randomBytes(4).readUInt32BE(0);
  let rstate = random || 1;
  const rng = () => { rstate = (1664525 * rstate + 1013904223) >>> 0; return rstate / 0x100000000; };
  let openedAt = 0, survived = 0, payout = 0, collisions = 0, cashout = 0, finish = 0;
  for (let lane = 1; lane <= LANES; lane++) {
    const opp = issueOpportunity('sim', lane, openedAt, windowSeconds);
    const arrival = chooseArrival({ traffic, lane, openedAt, expiresAt: opp.expiresAt, difficulty, policy: strategy, latency, rng });
    const resolvedAt = arrival === null ? opp.expiresAt : arrival;
    if (crossingCollision(traffic, lane, resolvedAt, difficulty)) { collisions++; break; }
    survived = lane;
    if (target === lane) {
      payout = Math.round(betCents * multiplier(difficulty, lane));
      cashout = 1;
      break;
    }
    openedAt = resolvedAt + CONFIG[difficulty].hopTime;
  }
  if (survived === LANES && target === 'finish') {
    // Finish opportunity has no vehicle lane and is subject to the same
    // one-shot deadline, but it cannot collide under current standalone rules.
    issueOpportunity('sim', LANES + 1, openedAt, windowSeconds);
    payout = Math.round(betCents * multiplier(difficulty, LANES) * 1.5);
    finish = 1;
  }
  return { payout, collisions, survived, cashout, finish };
}

function wilson(k, n) {
  const z = 1.96, p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2*n)) / d, r = z * Math.sqrt((p*(1-p)+z2/(4*n))/n) / d;
  return [Math.max(0,c-r), Math.min(1,c+r)];
}

function simulate({ rounds = 1000, windows = [0.25, 0.5, 1], bets = [100, 300, 50000] } = {}) {
  const out = [];
  for (const difficulty of ['easy','medium','hard']) for (const windowSeconds of windows)
    for (const [network, latency] of Object.entries(LATENCY))
      for (const strategy of ['immediate','fixed-delay','random-delay','adaptive-earliest','adaptive-latest'])
        for (const target of [3,7,14,'finish']) for (const betCents of bets) {
          let sum=0,sq=0,collision=0,survive=0,cash=0,fin=0,max=0;
          for(let i=0;i<rounds;i++){
            const r=runRound({difficulty,strategy,target,latency,windowSeconds,betCents});
            sum+=r.payout;sq+=r.payout*r.payout;collision+=r.collisions;survive+=r.survived>=target && target!=='finish'?1:r.survived===LANES?1:0;cash+=r.cashout;fin+=r.finish;max=Math.max(max,r.payout);
          }
          const mean=sum/rounds, se=Math.sqrt(Math.max(0,sq/rounds-mean*mean)/rounds);
          out.push({difficulty,window_seconds:windowSeconds,network,latency_seconds:latency,strategy,target,bet_santim:betCents,rounds,rtp:mean/betCents,rtp_ci95:[Math.max(0,mean-1.96*se)/betCents,(mean+1.96*se)/betCents],collision_rate:collision/rounds,collision_ci95:wilson(collision,rounds),survival_rate:survive/rounds,finish_rate:fin/rounds,cashout_rate:cash/rounds,average_payout_santim:mean,observed_max_payout_santim:max});
        }
  return out;
}

if(require.main===module){
  const rounds=Math.max(100,Number(process.argv[2])||1000);
  process.stdout.write(JSON.stringify(simulate({rounds}),null,2)+'\n');
}
module.exports={LATENCY,runRound,simulate};
