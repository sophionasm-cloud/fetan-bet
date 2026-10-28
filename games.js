// Demo games for Neon PostgreSQL. Virtual credits only.
// Randomness comes from the server (crypto), never the browser.
const crypto = require('crypto');
const { query, withTx, postLedger } = require('./db');
const { decimalFraction, grossPayoutCents, grossPayoutFromMultiplierCents, netWinningsCents } = require('./payout');

const MIN_BET = 100;      // 1 credit
const MAX_BET = 100000;   // 1000 credits
const PAYOUT_RULE_VERSION = 2;
const rnd = (n) => crypto.randomInt(0, n);

function checkBet(bet) {
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) throw new Error('INVALID');
}

async function saveRound(client, userId, game, bet, payout, detail, status = 'done', step = 0, serverSeed = null, clientSeed = null, serverSeedHash = null, difficulty = null) {
  const r = await client.query(
    `INSERT INTO game_rounds (user_id, game, bet, payout, step, status, detail, server_seed, client_seed, server_seed_hash, difficulty)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [userId, game, bet, payout, step, status, JSON.stringify(detail), serverSeed, clientSeed, serverSeedHash, difficulty]
  );
  return Number(r.rows[0].id);
}

// Helper: combinations nCr
function comb(n, r) {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  let c = 1;
  for (let i = 1; i <= r; i++) {
    c = (c * (n - i + 1)) / i;
  }
  return c;
}

// ---------- Roulette (single zero, 37 pockets) ----------
const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const ROULETTE_MULTIPLIERS = { number: 34.04, outside: 1.89 };
async function roulette(userId, bet, kind, value) {
  checkBet(bet);
  let valid = false;
  if (kind === 'number') valid = Number.isInteger(value) && value >= 0 && value <= 36;
  if (kind === 'color') valid = ['red', 'black'].includes(value);
  if (kind === 'parity') valid = ['even', 'odd'].includes(value);
  if (!valid) throw new Error('INVALID');

  return withTx(async (client) => {
    const roundId = await saveRound(client, userId, 'roulette', bet, 0, {});
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });
    const n = rnd(37);
    const color = n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black';
    let mult = 0;
    if (kind === 'number' && value === n) mult = ROULETTE_MULTIPLIERS.number;
    if (kind === 'color' && value === color) mult = ROULETTE_MULTIPLIERS.outside;
    if (kind === 'parity' && n !== 0 && value === (n % 2 ? 'odd' : 'even')) mult = ROULETTE_MULTIPLIERS.outside;
    const payout = grossPayoutCents(bet, mult);
    const net = netWinningsCents(payout, bet);
    if (payout > 0) {
      await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    }
    await client.query('UPDATE game_rounds SET payout=$1, detail=$2 WHERE id=$3', [payout, JSON.stringify({ kind, value, n, color }), roundId]);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return { n, color, mult, payout, net, balance };
  });
}

// ---------- Star Spin (3-reel slot with wild) ----------
const SYMBOLS = [
  ['cherry', '🍒', 30], ['lemon', '🍋', 25], ['bell', '🔔', 20],
  ['star', '⭐', 12], ['seven', '7️⃣', 6], ['wild', '🌟', 7],
];
const PAY3 = { cherry: 3.3, lemon: 5.28, bell: 7.92, star: 16.5, seven: 33, wild: 33 };
const STAR_REFUND_MULTIPLIER = 1;
function pickSymbol() {
  let r = rnd(100);
  for (const s of SYMBOLS) { if (r < s[2]) return s; r -= s[2]; }
  return SYMBOLS[0];
}
async function starSpin(userId, bet) {
  checkBet(bet);
  return withTx(async (client) => {
    const roundId = await saveRound(client, userId, 'star', bet, 0, {});
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });
    const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
    const names = reels.map((s) => s[0]);
    const normal = names.filter((n) => n !== 'wild');
    let mult = 0;
    if (normal.length === 0) mult = PAY3.wild;
    else if (normal.every((n) => n === normal[0])) mult = PAY3[normal[0]];     // wild substitutes
    else if (names.filter((n) => n === 'cherry' || n === 'wild').length >= 2) mult = STAR_REFUND_MULTIPLIER;
    const payout = grossPayoutCents(bet, mult);
    const net = netWinningsCents(payout, bet);
    if (payout > 0) {
      await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    }
    await client.query('UPDATE game_rounds SET payout=$1, detail=$2 WHERE id=$3', [payout, JSON.stringify({ names }), roundId]);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return { reels: reels.map((s) => s[1]), mult, payout, net, balance };
  });
}

// ---------- Road Dash (Chicken Crossing - 4 Difficulties, Provably Fair) ----------
const ROAD_CONFIG = {
  rtp: 0.92,
  difficulties: {
    easy:     { lanes: 24, p0: 0.033, step: 0.0050 },
    medium:   { lanes: 22, p0: 0.075, step: 0.0085 },
    hard:     { lanes: 20, p0: 0.140, step: 0.0110 },
    hardcore: { lanes: 15, p0: 0.240, step: 0.0160 }
  }
};

function getLaneCrashChance(difficulty, lane) {
  const cfg = ROAD_CONFIG.difficulties[difficulty] || ROAD_CONFIG.difficulties.easy;
  return Math.min(0.99, cfg.p0 + cfg.step * (lane - 1));
}

function getLadder(difficulty) {
  const cfg = ROAD_CONFIG.difficulties[difficulty] || ROAD_CONFIG.difficulties.easy;
  const scale = 10000n;
  let safeNumerator = 1n;
  let safeDenominator = 1n;
  const ladder = [];
  for (let i = 1; i <= cfg.lanes; i++) {
    const crashBasis = Math.round(getLaneCrashChance(difficulty, i) * Number(scale));
    safeNumerator *= scale - BigInt(crashBasis);
    safeDenominator *= scale;
    const multiplierCents = (92n * safeDenominator) / safeNumerator;
    ladder.push(Number(multiplierCents < 100n ? 100n : multiplierCents) / 100);
  }
  return ladder;
}

function getLegacyRoadLadder(difficulty) {
  const cfg = ROAD_CONFIG.difficulties[difficulty] || ROAD_CONFIG.difficulties.easy;
  let survival = 1;
  const ladder = [];
  for (let lane = 1; lane <= cfg.lanes; lane++) {
    survival *= 1 - getLaneCrashChance(difficulty, lane);
    ladder.push(Math.max(1.01, Math.floor((0.98 / survival) * 100) / 100));
  }
  return ladder;
}

function getRoadLadderForVersion(difficulty, version) {
  return version >= PAYOUT_RULE_VERSION ? getLadder(difficulty) : getLegacyRoadLadder(difficulty);
}

function getRoadMultiplierForVersion(difficulty, step, version) {
  const ladder = getRoadLadderForVersion(difficulty, version);
  return step <= 0 ? 0 : ladder[Math.min(step, ladder.length) - 1];
}

function getMultiplier(difficulty, step) {
  if (step <= 0) return 0;
  const ladder = getLadder(difficulty);
  if (step > ladder.length) return ladder[ladder.length - 1];
  return ladder[step - 1];
}

function isLaneHazard(serverSeed, clientSeed, lane, difficulty) {
  const pi = getLaneCrashChance(difficulty, lane);
  const msg = `${serverSeed}:${clientSeed}:${lane}`;
  const hex = crypto.createHash('sha256').update(msg).digest('hex');
  const val = parseInt(hex.slice(0, 8), 16) / 0x100000000;
  return val < pi;
}

async function activeRoadRound(userId, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const res = await q("SELECT * FROM game_rounds WHERE user_id=$1 AND game='road' AND status='active'", [userId]);
  return res.rows[0] || null;
}

async function roadState(userId, difficulty = 'easy') {
  const diff = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : 'easy';
  const r = await activeRoadRound(userId);
  const wRes = await query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
  const balance = Number(wRes.rows[0].balance);
  const activeDiff = r ? (r.difficulty || 'easy') : diff;
  const payoutVersion = r ? (JSON.parse(r.detail || '{}').payoutVersion || 1) : PAYOUT_RULE_VERSION;
  const ladder = getRoadLadderForVersion(activeDiff, payoutVersion);
  const maxSteps = ROAD_CONFIG.difficulties[activeDiff].lanes;

  if (!r) {
    return {
      active: false,
      balance,
      difficulty: diff,
      ladder,
      maxSteps,
      next: ladder[0],
      next_crash_chance: Number((getLaneCrashChance(diff, 1) * 100).toFixed(2)),
      config: ROAD_CONFIG
    };
  }

  const curDiff = r.difficulty || 'easy';
  const nextStep = r.step + 1;
  const nextMult = nextStep <= maxSteps ? getRoadMultiplierForVersion(curDiff, nextStep, payoutVersion) : 0;
  const nextChance = nextStep <= maxSteps ? Number((getLaneCrashChance(curDiff, nextStep) * 100).toFixed(2)) : 0;
  const curMult = r.step > 0 ? getRoadMultiplierForVersion(curDiff, r.step, payoutVersion) : 0;

  return {
    active: true,
    step: r.step,
    bet: Number(r.bet),
    difficulty: curDiff,
    mult: curMult,
    next: nextMult,
    next_crash_chance: nextChance,
    balance,
    maxSteps,
    ladder,
    payout_version: payoutVersion,
    server_seed_hash: r.server_seed_hash,
    client_seed: r.client_seed
  };
}

async function roadStart(userId, bet, difficulty = 'easy', clientSeed = '') {
  checkBet(bet);
  const diff = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : 'easy';
  return withTx(async (client) => {
    const existing = await client.query("SELECT id FROM game_rounds WHERE user_id=$1 AND game='road' AND status='active' FOR UPDATE", [userId]);
    if (existing.rows.length > 0) throw new Error('ACTIVE_ROUND');

    const sSeed = crypto.randomBytes(32).toString('hex');
    const sHash = crypto.createHash('sha256').update(sSeed).digest('hex');
    const cSeed = String(clientSeed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomBytes(16).toString('hex');

    const id = await saveRound(client, userId, 'road', bet, 0, { payoutVersion: PAYOUT_RULE_VERSION }, 'active', 0, sSeed, cSeed, sHash, diff);
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    const ladder = getRoadLadderForVersion(diff, PAYOUT_RULE_VERSION);
    const maxSteps = ROAD_CONFIG.difficulties[diff].lanes;
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);

    return {
      active: true,
      step: 0,
      bet,
      difficulty: diff,
      mult: 0,
      next: ladder[0],
      next_crash_chance: Number((getLaneCrashChance(diff, 1) * 100).toFixed(2)),
      balance,
      maxSteps,
      ladder,
      payout_version: PAYOUT_RULE_VERSION,
      server_seed_hash: sHash,
      client_seed: cSeed
    };
  });
}

async function roadStep(userId) {
  return withTx(async (client) => {
    const rRes = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='road' AND status='active' FOR UPDATE", [userId]);
    const r = rRes.rows[0];
    if (!r) throw new Error('NOT_FOUND');
    const diff = r.difficulty || 'easy';
    const payoutVersion = JSON.parse(r.detail || '{}').payoutVersion || 1;
    const maxSteps = ROAD_CONFIG.difficulties[diff].lanes;
    const nextLane = r.step + 1;

    const hit = isLaneHazard(r.server_seed, r.client_seed, nextLane, diff);

    if (hit) {
      await client.query("UPDATE game_rounds SET status='done', payout=0 WHERE id=$1 AND status='active'", [r.id]);
      const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      const balance = Number(wRes.rows[0].balance);
      return {
        result: 'hit',
        crashed: true,
        finished: true,
        lane: nextLane,
        step: nextLane,
        multiplier: 0,
        payout: 0,
        net: -Number(r.bet),
        balance,
        active: false,
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        ladder: getRoadLadderForVersion(diff, payoutVersion),
        maxSteps
      };
    }

    const newStep = nextLane;
    const curMult = getRoadMultiplierForVersion(diff, newStep, payoutVersion);

    if (newStep >= maxSteps) {
      const payout = grossPayoutCents(Number(r.bet), curMult);
      const net = netWinningsCents(payout, Number(r.bet));
      const upd = await client.query("UPDATE game_rounds SET status='done', step=$1, payout=$2 WHERE id=$3 AND status='active'", [newStep, payout, r.id]);
      if (upd.rowCount === 0) throw new Error('INVALID');
      await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
      const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      const balance = Number(wRes.rows[0].balance);
      return {
        result: 'safe',
        crashed: false,
        finished: true,
        lane: newStep,
        step: newStep,
        multiplier: curMult,
        mult: curMult,
        payout,
        net,
        balance,
        active: false,
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        ladder: getRoadLadderForVersion(diff, payoutVersion),
        maxSteps
      };
    }

    await client.query("UPDATE game_rounds SET step=$1 WHERE id=$2 AND status='active'", [newStep, r.id]);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    const nextChance = Number((getLaneCrashChance(diff, newStep + 1) * 100).toFixed(2));
    const nextMult = getRoadMultiplierForVersion(diff, newStep + 1, payoutVersion);

    return {
      result: 'safe',
      crashed: false,
      finished: false,
      lane: newStep,
      step: newStep,
      multiplier: curMult,
      mult: curMult,
      next: nextMult,
      next_multiplier: nextMult,
      next_crash_chance: nextChance,
      bet: Number(r.bet),
      difficulty: diff,
      balance,
      active: true,
      maxSteps,
      ladder: getRoadLadderForVersion(diff, payoutVersion),
      payout_version: payoutVersion,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed
    };
  });
}

async function roadCashout(userId) {
  return withTx(async (client) => {
    const rRes = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='road' AND status='active' FOR UPDATE", [userId]);
    const r = rRes.rows[0];
    if (!r || r.step < 1) throw new Error('INVALID');
    const diff = r.difficulty || 'easy';
    const payoutVersion = JSON.parse(r.detail || '{}').payoutVersion || 1;
    const mult = getRoadMultiplierForVersion(diff, r.step, payoutVersion);
    const payout = grossPayoutCents(Number(r.bet), mult);
    const net = netWinningsCents(payout, Number(r.bet));

    const upd = await client.query("UPDATE game_rounds SET status='done', payout=$1 WHERE id=$2 AND status='active'", [payout, r.id]);
    if (upd.rowCount === 0) throw new Error('INVALID');
    await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);

    return {
      payout,
      net,
      multiplier: mult,
      mult,
      finished: true,
      active: false,
      balance,
      server_seed: r.server_seed,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed,
      ladder: getRoadLadderForVersion(diff, payoutVersion),
      maxSteps: ROAD_CONFIG.difficulties[diff].lanes
    };
  });
}

async function roadHistory(userId) {
  const res = await query(
    `SELECT id, bet, payout, step, difficulty, status, detail, server_seed, client_seed, server_seed_hash, created_at
     FROM game_rounds
     WHERE user_id=$1 AND game='road'
     ORDER BY id DESC LIMIT 20`,
    [userId]
  );

  const history = res.rows.map((r) => {
    const diff = r.difficulty || 'easy';
    const bet = Number(r.bet);
    const payout = Number(r.payout);
    const payoutVersion = JSON.parse(r.detail || '{}').payoutVersion || 1;
    const mult = payout > 0 ? Number((payout / bet).toFixed(2)) : (r.step > 0 ? getRoadMultiplierForVersion(diff, r.step, payoutVersion) : 0);
    return {
      id: Number(r.id),
      bet,
      payout,
      step: r.step,
      difficulty: diff,
      multiplier: mult,
      result: payout > 0 ? 'win' : (r.status === 'done' ? 'crashed' : 'active'),
      server_seed: r.status === 'done' ? r.server_seed : null,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed,
      created_at: r.created_at
    };
  });
  return { history, rounds: history };
}

function roadVerify({ server_seed, client_seed, lane, difficulty = 'easy' }) {
  if (!server_seed || !client_seed || !lane) throw new Error('INVALID');
  const l = Number(lane);
  const diff = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : 'easy';
  const pi = getLaneCrashChance(diff, l);
  const msg = `${server_seed}:${client_seed}:${l}`;
  const hash = crypto.createHash('sha256').update(msg).digest('hex');
  const val = parseInt(hash.slice(0, 8), 16) / 0x100000000;
  const isHazard = val < pi;
  const serverSeedHash = crypto.createHash('sha256').update(server_seed).digest('hex');

  return {
    server_seed,
    server_seed_hash: serverSeedHash,
    client_seed,
    lane: l,
    difficulty: diff,
    p_i: Number(pi.toFixed(6)),
    computed_hash: hash,
    first_8_hex: hash.slice(0, 8),
    numeric_value: val,
    is_hazard: isHazard,
    outcome: isHazard ? 'hit' : 'safe'
  };
}

// ---------- Mines (Configurable Grid: 3x3, 5x5, 7x7, 9x9 with Provably Fair RNG) ----------
const MINES_GRIDS = [3, 5, 7, 9];
const MINES_DEFAULT_GRID = 5;
const MINES_HOUSE_EDGE = 0.08; // 8% target house edge before the retained payout cap
const MINES_MAX_WIN = 100000000; // Cap potential win at 1,000,000 credits (100,000,000 cents)

function combBigInt(n, r) {
  if (!Number.isInteger(n) || !Number.isInteger(r) || r < 0 || r > n) return 0n;
  const take = Math.min(r, n - r);
  let value = 1n;
  for (let i = 1; i <= take; i++) value = (value * BigInt(n - take + i)) / BigInt(i);
  return value;
}

function getMinesMultiplierCents(N, M, k, houseEdge = MINES_HOUSE_EDGE) {
  if (k <= 0) return 100n;
  if (k > N - M) return 0n;
  const targetMultiplierCents = BigInt(Math.floor((1 - houseEdge) * 100 + 1e-10));
  return (targetMultiplierCents * combBigInt(N, k)) / combBigInt(N - M, k);
}

function getLegacyMinesMultiplierCents(N, M, k) {
  if (k <= 0) return 100n;
  if (k > N - M) return 0n;
  let product = 1;
  for (let i = 0; i < k; i++) product *= (N - i) / (N - M - i);
  const multiplier = Math.max(1.01, Math.floor(0.99 * product * 100) / 100);
  return BigInt(Math.round(multiplier * 100));
}

function getMinesMultiplierCentsForVersion(N, M, k, version) {
  return version >= PAYOUT_RULE_VERSION
    ? getMinesMultiplierCents(N, M, k)
    : getLegacyMinesMultiplierCents(N, M, k);
}

function getMinesMultiplierForVersion(N, M, k, version) {
  return Number(getMinesMultiplierCentsForVersion(N, M, k, version)) / 100;
}

function getMinesMultiplier(N, M, k, houseEdge = MINES_HOUSE_EDGE) {
  return Number(getMinesMultiplierCents(N, M, k, houseEdge)) / 100;
}

function getMinesNextMultipliers(N, M, k, count = 4, houseEdge = MINES_HOUSE_EDGE, version = PAYOUT_RULE_VERSION) {
  const list = [];
  const maxSafe = N - M;
  for (let step = k + 1; step <= Math.min(maxSafe, k + count); step++) {
    list.push(version >= PAYOUT_RULE_VERSION
      ? getMinesMultiplier(N, M, step, houseEdge)
      : getMinesMultiplierForVersion(N, M, step, version));
  }
  return list;
}

function generateMinesLayout(serverSeed, clientSeed, nonce, totalCells, minesCount) {
  const arr = Array.from({ length: totalCells }, (_, i) => i);
  let hash = crypto.createHash('sha256').update(`${serverSeed}:${clientSeed}:${nonce}`).digest('hex');
  let byteOffset = 0;
  for (let i = arr.length - 1; i > 0; i--) {
    if (byteOffset + 8 > hash.length) {
      hash = crypto.createHash('sha256').update(hash).digest('hex');
      byteOffset = 0;
    }
    const randVal = parseInt(hash.slice(byteOffset, byteOffset + 8), 16);
    byteOffset += 8;
    const j = randVal % (i + 1);
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr.slice(0, minesCount).sort((a, b) => a - b);
}

async function activeMinesRound(userId, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const res = await q("SELECT * FROM game_rounds WHERE user_id=$1 AND game='mines' AND status='active'", [userId]);
  return res.rows[0] || null;
}

async function minesState(userId) {
  const r = await activeMinesRound(userId);
  const wRes = await query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
  const balance = Number(wRes.rows[0].balance);
  if (!r) return { active: false, balance, grid: MINES_DEFAULT_GRID, mines: 5 };
  const detail = JSON.parse(r.detail);
  const g = detail.grid || MINES_DEFAULT_GRID;
  const N = g * g;
  const m = detail.minesCount;
  const k = detail.revealed.length;
  const payoutVersion = detail.payoutVersion || 1;
  const mult = k > 0 ? getMinesMultiplierForVersion(N, m, k, payoutVersion) : 1;
  const safeLeft = N - m - k;
  const bet = Number(r.bet);
  const potential = grossPayoutFromMultiplierCents(bet, getMinesMultiplierCentsForVersion(N, m, k, payoutVersion), MINES_MAX_WIN);
  const nextList = getMinesNextMultipliers(N, m, k, 4, MINES_HOUSE_EDGE, payoutVersion);

  return {
    active: true,
    balance,
    bet,
    step: r.step,
    grid: g,
    total_cells: N,
    mines: m,
    revealed: detail.revealed,
    safe_left: safeLeft,
    mult,
    payout_version: payoutVersion,
    potential,
    next_multipliers: nextList,
    server_seed_hash: r.server_seed_hash,
    client_seed: r.client_seed
  };
}

async function minesStart(userId, bet, minesCount = 5, gridSize = 5, clientSeed = '') {
  checkBet(bet);
  const g = Number(gridSize) || MINES_DEFAULT_GRID;
  if (!MINES_GRIDS.includes(g)) throw new Error('INVALID');
  const N = g * g;
  const m = Number(minesCount);
  if (!Number.isInteger(m) || m < 1 || m > N - 1) throw new Error('INVALID');

  return withTx(async (client) => {
    const existingRes = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='mines' AND status='active' FOR UPDATE", [userId]);
    const existing = existingRes.rows[0];
    if (existing) {
      const d = JSON.parse(existing.detail);
      if (d.revealed && d.revealed.length === 0) {
        await postLedger({ client, userId, delta: Number(existing.bet), type: 'refund', refType: 'round', refId: Number(existing.id) });
        await client.query("UPDATE game_rounds SET status='done' WHERE id=$1", [existing.id]);
      } else {
        throw new Error('ACTIVE_ROUND');
      }
    }

    const sSeed = crypto.randomBytes(32).toString('hex');
    const sHash = crypto.createHash('sha256').update(sSeed).digest('hex');
    const cSeed = String(clientSeed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomBytes(16).toString('hex');
    const nonce = 1;

    const mines = generateMinesLayout(sSeed, cSeed, nonce, N, m);
    const detail = { grid: g, totalCells: N, mines, revealed: [], minesCount: m, nonce, payoutVersion: PAYOUT_RULE_VERSION };
    const id = await saveRound(client, userId, 'mines', bet, 0, detail, 'active', 0, sSeed, cSeed, sHash);
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    const nextList = getMinesNextMultipliers(N, m, 0, 4, MINES_HOUSE_EDGE, PAYOUT_RULE_VERSION);

    return {
      active: true,
      balance,
      grid: g,
      total_cells: N,
      // NOTE: 'mines' (the layout) is intentionally NOT sent to the client while the round is active
      mines_count: m,
      safe_left: N - m,
      bet,
      revealed: [],
      mult: 1,
      potential: bet,
      next_multipliers: nextList,
      server_seed_hash: sHash,
      client_seed: cSeed
    };
  });
}

async function minesStep(userId, cell) {
  const c = Number(cell);
  return withTx(async (client) => {
    const rRes = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='mines' AND status='active' FOR UPDATE", [userId]);
    const r = rRes.rows[0];
    if (!r) throw new Error('NOT_FOUND');
    const detail = JSON.parse(r.detail);
    const g = detail.grid || MINES_DEFAULT_GRID;
    const N = g * g;
    const payoutVersion = detail.payoutVersion || 1;
    if (!Number.isInteger(c) || c < 0 || c >= N) throw new Error('INVALID');
    if (detail.revealed.includes(c)) throw new Error('INVALID');
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    const bet = Number(r.bet);

    if (detail.mines.includes(c)) {
      const upd = await client.query("UPDATE game_rounds SET status='done', payout=0 WHERE id=$1 AND status='active'", [r.id]);
      if (upd.rowCount === 0) throw new Error('INVALID');
      return {
        result: 'mine',
        mine: true,
        tile: c,
        finished: true,
        hit_mine: c,
        mines: detail.mines,
        multiplier: 0,
        mult: 0,
        payout: 0,
        net: -Number(r.bet),
        balance,
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        nonce: detail.nonce || 1
      };
    }

    detail.revealed.push(c);
    const k = detail.revealed.length;
    const m = detail.minesCount;
    const mult = getMinesMultiplierForVersion(N, m, k, payoutVersion);
    const safeLeft = N - m - k;
    const multCents = getMinesMultiplierCentsForVersion(N, m, k, payoutVersion);
    const potential = grossPayoutFromMultiplierCents(bet, multCents, MINES_MAX_WIN);
    const net = netWinningsCents(potential, bet);
    const nextList = getMinesNextMultipliers(N, m, k, 4, MINES_HOUSE_EDGE, payoutVersion);

    if (safeLeft === 0) {
      const upd = await client.query("UPDATE game_rounds SET status='done', payout=$1, step=$2, detail=$3 WHERE id=$4 AND status='active'", [potential, k, JSON.stringify(detail), r.id]);
      if (upd.rowCount === 0) throw new Error('INVALID');
      await postLedger({ client, userId, delta: potential, type: 'win', refType: 'round', refId: Number(r.id) });
      const newBalRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      const newBal = Number(newBalRes.rows[0].balance);
      return {
        result: 'safe',
        mine: false,
        tile: c,
        finished: true,
        safe_left: 0,
        multiplier: mult,
        mult,
        payout: potential,
        net,
        potential,
        balance: newBal,
        mines: detail.mines,
        next_multipliers: [],
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        nonce: detail.nonce || 1
      };
    }

    const upd = await client.query("UPDATE game_rounds SET step=$1, detail=$2 WHERE id=$3 AND status='active'", [k, JSON.stringify(detail), r.id]);
    if (upd.rowCount === 0) throw new Error('INVALID');
    return {
      result: 'safe',
      mine: false,
      tile: c,
      finished: false,
      safe_left: safeLeft,
      multiplier: mult,
      mult,
      potential,
      balance,
      next_multipliers: nextList
    };
  });
}

async function minesCashout(userId) {
  return withTx(async (client) => {
    const rRes = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='mines' AND status='active' FOR UPDATE", [userId]);
    const r = rRes.rows[0];
    if (!r) throw new Error('NOT_FOUND');
    const detail = JSON.parse(r.detail);
    const g = detail.grid || MINES_DEFAULT_GRID;
    const N = g * g;
    const payoutVersion = detail.payoutVersion || 1;
    const k = detail.revealed.length;
    if (k < 1) throw new Error('INVALID');
    const m = detail.minesCount;
    const mult = getMinesMultiplierForVersion(N, m, k, payoutVersion);
    const bet = Number(r.bet);
    const payout = grossPayoutFromMultiplierCents(bet, getMinesMultiplierCentsForVersion(N, m, k, payoutVersion), MINES_MAX_WIN);
    const net = netWinningsCents(payout, bet);

    const upd = await client.query("UPDATE game_rounds SET status='done', payout=$1 WHERE id=$2 AND status='active'", [payout, r.id]);
    if (upd.rowCount === 0) throw new Error('INVALID');
    await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: Number(r.id) });
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return {
      finished: true,
      payout,
      net,
      multiplier: mult,
      mult,
      balance,
      mines: detail.mines,
      server_seed: r.server_seed,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed,
      nonce: detail.nonce || 1
    };
  });
}

function minesVerify({ server_seed, client_seed, nonce = 1, grid = 5, mines = 5 }) {
  if (!server_seed || !client_seed) throw new Error('INVALID');
  const g = Number(grid) || 5;
  const N = g * g;
  const m = Number(mines) || 5;
  const layout = generateMinesLayout(server_seed, client_seed, nonce, N, m);
  const serverSeedHash = crypto.createHash('sha256').update(server_seed).digest('hex');
  return {
    server_seed,
    server_seed_hash: serverSeedHash,
    client_seed,
    nonce: Number(nonce),
    grid: g,
    total_cells: N,
    mines_count: m,
    mines: layout
  };
}

// ---------- Plinko (Stake reference: 8-16 rows, Low/Medium/High risk) ----------
const PLINKO_BASE_PAYOUTS = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  9: {
    low: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6],
    medium: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
    high: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
  },
  10: {
    low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
    medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
  },
  11: {
    low: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4],
    medium: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
    high: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  13: {
    low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1],
    medium: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
    high: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
  },
  14: {
    low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
    medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
    high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
  },
  15: {
    low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15],
    medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88],
    high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

function multiplierCents(multiplier) {
  const { numerator, denominator } = decimalFraction(multiplier);
  return (numerator * 100n) / denominator;
}

function binomialWeights(rows) {
  const weights = [1n];
  for (let i = 0; i < rows; i++) {
    const next = Array(weights.length + 1).fill(0n);
    for (let j = 0; j < weights.length; j++) {
      next[j] += weights[j];
      next[j + 1] += weights[j];
    }
    weights.splice(0, weights.length, ...next);
  }
  return weights;
}

function makePlinkoTargetTable(baseTable) {
  const result = {};
  for (const [rowText, risks] of Object.entries(baseTable)) {
    const rows = Number(rowText);
    const weights = binomialWeights(rows);
    const centerBuckets = rows % 2 === 0
      ? [rows / 2]
      : [Math.floor(rows / 2), Math.ceil(rows / 2)];
    const reservedWeight = centerBuckets.reduce((sum, bucket) => sum + weights[bucket], 0n);
    const targetWeightedCents = 92n * (1n << BigInt(rows));
    const remainingTarget = targetWeightedCents - 100n * reservedWeight;
    result[rows] = {};
    for (const [risk, sourceMultipliers] of Object.entries(risks)) {
      const sourceCents = sourceMultipliers.map(multiplierCents);
      const weightedTotal = sourceCents.reduce((sum, cents, index) =>
        centerBuckets.includes(index) ? sum : sum + cents * weights[index], 0n);
      result[rows][risk] = sourceCents.map((cents, index) => centerBuckets.includes(index)
        ? 1
        : Number((cents * remainingTarget) / weightedTotal) / 100);
    }
  }
  return result;
}

const PLINKO_PAYOUTS = makePlinkoTargetTable(PLINKO_BASE_PAYOUTS);

function generatePlinkoPath(serverSeed, clientSeed, nonce, rowCount) {
  const path = [];
  let bucket = 0;
  for (let r = 0; r < rowCount; r++) {
    const msg = `${serverSeed}:${clientSeed}:${nonce}:${r}`;
    const hash = crypto.createHash('sha256').update(msg).digest('hex');
    const val = parseInt(hash.slice(0, 8), 16);
    const bit = val % 2; // 0 = left, 1 = right
    path.push(bit);
    bucket += bit;
  }
  return { path, bucket };
}

async function plinko(userId, bet, rows = 10, risk = 'medium', clientSeed = '', nonce = 1) {
  checkBet(bet);
  const rowCount = Number(rows);
  if (!Number.isInteger(rowCount) || rowCount < 8 || rowCount > 16) throw new Error('INVALID');
  const riskLevel = String(risk).toLowerCase();
  if (!['low', 'medium', 'high'].includes(riskLevel)) throw new Error('INVALID');

  const table = PLINKO_PAYOUTS[rowCount][riskLevel];
  const sSeed = crypto.randomBytes(32).toString('hex');
  const sHash = crypto.createHash('sha256').update(sSeed).digest('hex');
  const nextServerSeed = crypto.randomBytes(32).toString('hex');
  const nextSeedHash = crypto.createHash('sha256').update(nextServerSeed).digest('hex');
  const cSeed = String(clientSeed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomBytes(16).toString('hex');
  const nNonce = Number(nonce) || 1;

  const { path, bucket } = generatePlinkoPath(sSeed, cSeed, nNonce, rowCount);
  const mult = table[bucket] !== undefined ? table[bucket] : 1;
  const payout = grossPayoutCents(bet, mult);
  const net = netWinningsCents(payout, bet);

  return withTx(async (client) => {
    const detail = {
      path,
      steps: path,
      bucket,
      mult,
      rows: rowCount,
      risk: riskLevel,
      nonce: nNonce
    };
    const roundId = await saveRound(client, userId, 'plinko', bet, payout, detail, 'done', rowCount, sSeed, cSeed, sHash);
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });
    if (payout > 0) {
      await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    }

    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return {
      path,
      steps: path,
      bucket,
      multiplier: mult,
      mult,
      payout,
      net,
      balance,
      rows: rowCount,
      risk: riskLevel,
      server_seed: sSeed,
      server_seed_hash: sHash,
      client_seed: cSeed,
      nonce: nNonce,
      next_server_seed_hash: nextSeedHash
    };
  });
}

function plinkoVerify({ server_seed, client_seed, nonce = 1, rows = 10, risk = 'medium' }) {
  if (!server_seed || !client_seed) throw new Error('INVALID');
  const rowCount = Number(rows);
  if (!Number.isInteger(rowCount) || rowCount < 8 || rowCount > 16) throw new Error('INVALID');
  const riskLevel = String(risk).toLowerCase();
  if (!['low', 'medium', 'high'].includes(riskLevel)) throw new Error('INVALID');

  const { path, bucket } = generatePlinkoPath(server_seed, client_seed, Number(nonce) || 1, rowCount);
  const table = PLINKO_PAYOUTS[rowCount][riskLevel];
  const mult = table[bucket];
  const serverSeedHash = crypto.createHash('sha256').update(server_seed).digest('hex');

  return {
    server_seed,
    server_seed_hash: serverSeedHash,
    client_seed,
    nonce: Number(nonce) || 1,
    rows: rowCount,
    risk: riskLevel,
    path,
    steps: path,
    bucket,
    multiplier: mult,
    mult
  };
}

// ---------- Keno (1-80, pick 1-10 spots, draw 20) ----------
const KENO_PAY = {
  1:  { 1: 3.68 },
  2:  { 2: 15.30 },
  3:  { 2: 2.21, 3: 44.20 },
  4:  { 2: 1.63, 3: 5.46, 4: 109.32 },
  5:  { 3: 3.61, 4: 24.06, 5: 505.41 },
  6:  { 3: 1.95, 4: 7.81, 5: 78.13, 6: 1562.68 },
  7:  { 3: 1.20, 4: 4.01, 5: 20.09, 6: 257.23, 7: 5626.96 },
  8:  { 4: 3.04, 5: 10.43, 6: 86.97, 7: 1478.54, 8: 8697.33 },
  9:  { 4: 1.84, 5: 5.16, 6: 36.87, 7: 368.77, 8: 2950.16, 9: 22126.22 },
  10: { 5: 3.56, 6: 17.82, 7: 178.27, 8: 1426.16, 9: 7130.81, 10: 71308.13 },
};

const BINGO_PAYOUT_TIERS = [
  { maxDraw: 20, multiplier: 3.71 },
  { maxDraw: 30, multiplier: 1.98 },
  { maxDraw: 40, multiplier: 0.99 },
  { maxDraw: 50, multiplier: 0.62 },
  { maxDraw: 75, multiplier: 0.37 },
];

function getBingoMultiplier(drawCount) {
  return BINGO_PAYOUT_TIERS.find((tier) => drawCount <= tier.maxDraw)?.multiplier || 0;
}

function getLegacyBingoMultiplier(drawCount) {
  if (drawCount <= 20) return 15;
  if (drawCount <= 30) return 8;
  if (drawCount <= 40) return 4;
  if (drawCount <= 50) return 2.5;
  if (drawCount <= 75) return 1.5;
  return 0;
}

function getBingoMultiplierForVersion(drawCount, version) {
  return version >= PAYOUT_RULE_VERSION
    ? getBingoMultiplier(drawCount)
    : getLegacyBingoMultiplier(drawCount);
}

async function keno(userId, bet, picks) {
  checkBet(bet);
  const picksArr = (Array.isArray(picks) ? picks : []).map(Number);
  if (picksArr.length < 1 || picksArr.length > 10) throw new Error('INVALID');
  if (picksArr.some((n) => !Number.isInteger(n) || n < 1 || n > 80)) throw new Error('INVALID');
  if (new Set(picksArr).size !== picksArr.length) throw new Error('INVALID');

  return withTx(async (client) => {
    const roundId = await saveRound(client, userId, 'keno', bet, 0, {});
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });

    const pool = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const drawn = pool.slice(0, 20);

    const matched = picksArr.filter((p) => drawn.includes(p)).length;
    const payRow = KENO_PAY[picksArr.length] || {};
    const mult = payRow[matched] || 0;
    const payout = grossPayoutCents(bet, mult);
    const net = netWinningsCents(payout, bet);

    if (payout > 0) {
      await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    }
    await client.query('UPDATE game_rounds SET payout=$1, detail=$2 WHERE id=$3', [payout, JSON.stringify({ picks: picksArr, drawn, matched, mult }), roundId]);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return { drawn, matched, mult, payout, net, balance };
  });
}

// ---------- Ethiopian Bingo ----------
function generateBingoCard() {
  const cols = [
    { start: 1,  end: 15 },   // B
    { start: 16, end: 30 },   // I
    { start: 31, end: 45 },   // N
    { start: 46, end: 60 },   // G
    { start: 61, end: 75 },   // O
  ];
  const card = [];
  for (let col = 0; col < 5; col++) {
    const { start, end } = cols[col];
    const pool = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    card.push(pool.slice(0, 5));
  }
  card[2][2] = 0; // FREE center
  return card;
}

function checkBingoWin(marked, card) {
  const m = (row, col) => row === 2 && col === 2 ? true : marked[row * 5 + col];
  for (let row = 0; row < 5; row++) {
    if ([0,1,2,3,4].every((col) => m(row, col))) return true;
  }
  for (let col = 0; col < 5; col++) {
    if ([0,1,2,3,4].every((row) => m(row, col))) return true;
  }
  if ([0,1,2,3,4].every((i) => m(i, i))) return true;
  if ([0,1,2,3,4].every((i) => m(i, 4 - i))) return true;
  return false;
}

async function bingoStart(userId, bet) {
  checkBet(bet);
  return withTx(async (client) => {
    const existing = await client.query("SELECT id FROM game_rounds WHERE user_id=$1 AND game='bingo' AND status='active' FOR UPDATE", [userId]);
    if (existing.rows.length > 0) {
      await client.query("UPDATE game_rounds SET status='done' WHERE id=$1", [existing.rows[0].id]);
    }
    const card = generateBingoCard();
    const detail = { card, drawn: [], marked: new Array(25).fill(false), payoutVersion: PAYOUT_RULE_VERSION };
    const id = await saveRound(client, userId, 'bingo', bet, 0, detail, 'active', 0);
    await postLedger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return { id, card, drawn: [], balance, payout_version: PAYOUT_RULE_VERSION };
  });
}

async function bingoState(userId) {
  const res = await query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='bingo' AND status='active'", [userId]);
  const r = res.rows[0];
  const wRes = await query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
  const balance = Number(wRes.rows[0].balance);
  if (!r) return { active: false, balance };
  const detail = JSON.parse(r.detail);
  return { active: true, id: Number(r.id), card: detail.card, drawn: detail.drawn, marked: detail.marked, bet: Number(r.bet), balance, payout_version: detail.payoutVersion || 1 };
}

async function bingoCall(userId) {
  return withTx(async (client) => {
    const res = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='bingo' AND status='active' FOR UPDATE", [userId]);
    const r = res.rows[0];
    if (!r) throw new Error('NOT_FOUND');
    const detail = JSON.parse(r.detail);

    const remaining = [];
    for (let n = 1; n <= 75; n++) {
      if (!detail.drawn.includes(n)) remaining.push(n);
    }
    if (remaining.length === 0) throw new Error('INVALID');

    const idx = rnd(remaining.length);
    const called = remaining[idx];
    detail.drawn.push(called);

    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 5; row++) {
        if (detail.card[col][row] === called) {
          detail.marked[row * 5 + col] = true;
        }
      }
    }

    const won = checkBingoWin(detail.marked, detail.card);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);

    if (won) {
      const drawCount = detail.drawn.length;
      const mult = getBingoMultiplierForVersion(drawCount, detail.payoutVersion || 1);
      const payout = grossPayoutCents(Number(r.bet), mult);
      const net = netWinningsCents(payout, Number(r.bet));
      await postLedger({ client, userId, delta: payout, type: 'win', refType: 'round', refId: Number(r.id) });
      await client.query("UPDATE game_rounds SET status='done', payout=$1, detail=$2 WHERE id=$3", [payout, JSON.stringify(detail), r.id]);
      const newBalRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      const newBal = Number(newBalRes.rows[0].balance);
      return { called, drawn: detail.drawn, marked: detail.marked, won: true, payout, net, mult, balance: newBal };
    }

    await client.query("UPDATE game_rounds SET step=step+1, detail=$1 WHERE id=$2", [JSON.stringify(detail), r.id]);
    return { called, drawn: detail.drawn, marked: detail.marked, won: false, balance };
  });
}

async function bingoAbandon(userId) {
  return withTx(async (client) => {
    const res = await client.query("SELECT * FROM game_rounds WHERE user_id=$1 AND game='bingo' AND status='active' FOR UPDATE", [userId]);
    const r = res.rows[0];
    if (!r) return {};
    await client.query("UPDATE game_rounds SET status='done' WHERE id=$1", [r.id]);
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    const balance = Number(wRes.rows[0].balance);
    return { balance };
  });
}

module.exports = {
  roulette,
  ROULETTE_MULTIPLIERS,
  starSpin,
  SYMBOLS,
  PAY3,
  STAR_REFUND_MULTIPLIER,
  roadState,
  roadStart,
  roadStep,
  roadCashout,
  roadHistory,
  roadVerify,
  ROAD_CONFIG,
  getLadder,
  getMultiplier,
  getLegacyRoadLadder,
  getRoadLadderForVersion,
  minesState,
  minesStart,
  minesStep,
  minesCashout,
  minesVerify,
  MINES_GRIDS,
  getMinesMultiplier,
  getMinesMultiplierCents,
  getMinesMultiplierCentsForVersion,
  getMinesMultiplierForVersion,
  getMinesNextMultipliers,
  generateMinesLayout,
  plinko,
  plinkoVerify,
  generatePlinkoPath,
  PLINKO_BASE_PAYOUTS,
  PLINKO_PAYOUTS,
  keno,
  bingoStart,
  bingoState,
  bingoCall,
  bingoAbandon,
  MIN_BET,
  MAX_BET,
  MINES_MAX_WIN,
  KENO_PAY,
  BINGO_PAYOUT_TIERS,
  getBingoMultiplier,
  getLegacyBingoMultiplier,
  getBingoMultiplierForVersion,
};
