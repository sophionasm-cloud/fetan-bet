// Demo games. Virtual credits only. Randomness comes from the server (crypto), never the browser.
// NOTE: this is a teaching demo, NOT a certified RNG and NOT suitable for real-money use.
const crypto = require('crypto');
const { db, postLedger } = require('./db');

const MIN_BET = 100;      // 1 credit
const MAX_BET = 100000;   // 1000 credits
const rnd = (n) => crypto.randomInt(0, n);

function checkBet(bet) {
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) throw new Error('INVALID');
}
function saveRound(userId, game, bet, payout, detail, status = 'done', step = 0, serverSeed = null, clientSeed = null, serverSeedHash = null, difficulty = null) {
  return Number(db.prepare('INSERT INTO game_rounds (user_id, game, bet, payout, step, status, detail, server_seed, client_seed, server_seed_hash, difficulty) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(userId, game, bet, payout, step, status, JSON.stringify(detail), serverSeed, clientSeed, serverSeedHash, difficulty).lastInsertRowid);
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
function roulette(userId, bet, kind, value) {
  checkBet(bet);
  let valid = false;
  if (kind === 'number') valid = Number.isInteger(value) && value >= 0 && value <= 36;
  if (kind === 'color') valid = ['red', 'black'].includes(value);
  if (kind === 'parity') valid = ['even', 'odd'].includes(value);
  if (!valid) throw new Error('INVALID');
  return db.transaction(() => {
    const roundId = saveRound(userId, 'roulette', bet, 0, {});
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });
    const n = rnd(37);
    const color = n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black';
    let mult = 0;
    if (kind === 'number' && value === n) mult = 36;                         // pays 35:1
    if (kind === 'color' && value === color) mult = 2;                        // pays 1:1
    if (kind === 'parity' && n !== 0 && value === (n % 2 ? 'odd' : 'even')) mult = 2;
    const payout = bet * mult;
    if (payout > 0) postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    db.prepare('UPDATE game_rounds SET payout=?, detail=? WHERE id=?').run(payout, JSON.stringify({ kind, value, n, color }), roundId);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { n, color, payout, balance };
  })();
}

// ---------- Star Spin (3-reel slot with wild) ----------
const SYMBOLS = [
  ['cherry', '🍒', 30], ['lemon', '🍋', 25], ['bell', '🔔', 20],
  ['star', '⭐', 12], ['seven', '7️⃣', 6], ['wild', '🌟', 7],
];
const PAY3 = { cherry: 5, lemon: 8, bell: 12, star: 25, seven: 50, wild: 50 };
function pickSymbol() {
  let r = rnd(100);
  for (const s of SYMBOLS) { if (r < s[2]) return s; r -= s[2]; }
  return SYMBOLS[0];
}
function starSpin(userId, bet) {
  checkBet(bet);
  return db.transaction(() => {
    const roundId = saveRound(userId, 'star', bet, 0, {});
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });
    const reels = [pickSymbol(), pickSymbol(), pickSymbol()];
    const names = reels.map((s) => s[0]);
    const normal = names.filter((n) => n !== 'wild');
    let mult = 0;
    if (normal.length === 0) mult = PAY3.wild;
    else if (normal.every((n) => n === normal[0])) mult = PAY3[normal[0]];     // wild substitutes
    else if (names.filter((n) => n === 'cherry' || n === 'wild').length >= 2) mult = 1; // two cherries: bet back
    const payout = bet * mult;
    if (payout > 0) postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    db.prepare('UPDATE game_rounds SET payout=?, detail=? WHERE id=?').run(payout, JSON.stringify({ names }), roundId);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { reels: reels.map((s) => s[1]), mult, payout, balance };
  })();
}

// ---------- Road Dash (Chicken Crossing - 4 Difficulties, Provably Fair) ----------
const ROAD_CONFIG = {
  rtp: 0.98,
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
  let prod = 1;
  const ladder = [];
  for (let i = 1; i <= cfg.lanes; i++) {
    const pi = getLaneCrashChance(difficulty, i);
    prod *= (1 - pi);
    const m = Math.max(1.01, Math.floor((ROAD_CONFIG.rtp / prod) * 100) / 100);
    ladder.push(m);
  }
  return ladder;
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

function activeRound(userId) {
  return db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='road' AND status='active'").get(userId);
}

function roadState(userId, difficulty = 'easy') {
  const diff = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : 'easy';
  const r = activeRound(userId);
  const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
  const activeDiff = r ? (r.difficulty || 'easy') : diff;
  const ladder = getLadder(activeDiff);
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
  const nextMult = nextStep <= maxSteps ? getMultiplier(curDiff, nextStep) : 0;
  const nextChance = nextStep <= maxSteps ? Number((getLaneCrashChance(curDiff, nextStep) * 100).toFixed(2)) : 0;
  const curMult = r.step > 0 ? getMultiplier(curDiff, r.step) : 0;

  return {
    active: true,
    step: r.step,
    bet: r.bet,
    difficulty: curDiff,
    mult: curMult,
    next: nextMult,
    next_crash_chance: nextChance,
    balance,
    maxSteps,
    ladder,
    server_seed_hash: r.server_seed_hash,
    client_seed: r.client_seed
  };
}

function roadStart(userId, bet, difficulty = 'easy', clientSeed = '') {
  checkBet(bet);
  const diff = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : 'easy';
  return db.transaction(() => {
    if (activeRound(userId)) throw new Error('ACTIVE_ROUND');
    const sSeed = crypto.randomBytes(32).toString('hex');
    const sHash = crypto.createHash('sha256').update(sSeed).digest('hex');
    const cSeed = String(clientSeed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomBytes(16).toString('hex');

    const id = saveRound(userId, 'road', bet, 0, {}, 'active', 0, sSeed, cSeed, sHash, diff);
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    return roadState(userId, diff);
  })();
}

function roadStep(userId) {
  return db.transaction(() => {
    const r = activeRound(userId);
    if (!r) throw new Error('NOT_FOUND');
    const diff = r.difficulty || 'easy';
    const maxSteps = ROAD_CONFIG.difficulties[diff].lanes;
    const nextLane = r.step + 1;

    // Check if nextLane is a hazard according to provably fair formula
    const hit = isLaneHazard(r.server_seed, r.client_seed, nextLane, diff);

    if (hit) {
      db.prepare("UPDATE game_rounds SET status='done', payout=0 WHERE id=? AND status='active'").run(r.id);
      const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
      return {
        result: 'hit',
        crashed: true,
        finished: true,
        lane: nextLane,
        step: nextLane,
        multiplier: 0,
        payout: 0,
        balance,
        active: false,
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        ladder: getLadder(diff),
        maxSteps
      };
    }

    const newStep = nextLane;
    const curMult = getMultiplier(diff, newStep);

    if (newStep >= maxSteps) {
      // Auto cash-out at last lane
      const payout = Math.floor(r.bet * curMult);
      const info = db.prepare("UPDATE game_rounds SET status='done', step=?, payout=? WHERE id=? AND status='active'").run(newStep, payout, r.id);
      if (info.changes === 0) throw new Error('INVALID');
      postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
      const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
      return {
        result: 'safe',
        crashed: false,
        finished: true,
        lane: newStep,
        step: newStep,
        multiplier: curMult,
        mult: curMult,
        payout,
        balance,
        active: false,
        server_seed: r.server_seed,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        ladder: getLadder(diff),
        maxSteps
      };
    }

    db.prepare("UPDATE game_rounds SET step=? WHERE id=? AND status='active'").run(newStep, r.id);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    const nextChance = Number((getLaneCrashChance(diff, newStep + 1) * 100).toFixed(2));
    const nextMult = getMultiplier(diff, newStep + 1);

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
      bet: r.bet,
      difficulty: diff,
      balance,
      active: true,
      maxSteps,
      ladder: getLadder(diff),
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed
    };
  })();
}

function roadCashout(userId) {
  return db.transaction(() => {
    const r = activeRound(userId);
    if (!r || r.step < 1) throw new Error('INVALID');
    const diff = r.difficulty || 'easy';
    const mult = getMultiplier(diff, r.step);
    const payout = Math.floor(r.bet * mult);

    const info = db.prepare("UPDATE game_rounds SET status='done', payout=? WHERE id=? AND status='active'").run(payout, r.id);
    if (info.changes === 0) throw new Error('INVALID');
    postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;

    return {
      payout,
      multiplier: mult,
      mult,
      finished: true,
      active: false,
      balance,
      server_seed: r.server_seed,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed,
      ladder: getLadder(diff),
      maxSteps: ROAD_CONFIG.difficulties[diff].lanes
    };
  })();
}

function roadHistory(userId) {
  const rows = db.prepare(`
    SELECT id, bet, payout, step, difficulty, status, server_seed, client_seed, server_seed_hash, created_at
    FROM game_rounds
    WHERE user_id=? AND game='road'
    ORDER BY id DESC LIMIT 20
  `).all(userId);

  const history = rows.map((r) => {
    const diff = r.difficulty || 'easy';
    const mult = r.payout > 0 ? Number((r.payout / r.bet).toFixed(2)) : (r.step > 0 ? getMultiplier(diff, r.step) : 0);
    return {
      id: r.id,
      bet: r.bet,
      payout: r.payout,
      step: r.step,
      difficulty: diff,
      multiplier: mult,
      result: r.payout > 0 ? 'win' : (r.status === 'done' ? 'crashed' : 'active'),
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
const MINES_HOUSE_EDGE = 0.01; // 1% house edge => 0.99 RTP factor
const MINES_MAX_WIN = 100000000; // Cap potential win at 1,000,000 credits (100,000,000 cents)

function getMinesMultiplier(N, M, k, houseEdge = MINES_HOUSE_EDGE) {
  if (k <= 0) return 1;
  if (k > N - M) return 0;
  let prod = 1;
  for (let i = 0; i < k; i++) {
    prod *= (N - i) / (N - M - i);
  }
  const mult = Math.floor((1 - houseEdge) * prod * 100) / 100;
  return Math.max(1.01, mult);
}

function getMinesNextMultipliers(N, M, k, count = 4, houseEdge = MINES_HOUSE_EDGE) {
  const list = [];
  const maxSafe = N - M;
  for (let step = k + 1; step <= Math.min(maxSafe, k + count); step++) {
    list.push(getMinesMultiplier(N, M, step, houseEdge));
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

function activeMinesRound(userId) {
  return db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='mines' AND status='active'").get(userId);
}

function minesState(userId) {
  const r = activeMinesRound(userId);
  const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
  if (!r) return { active: false, balance, grid: MINES_DEFAULT_GRID, mines: 5 };
  const detail = JSON.parse(r.detail);
  const g = detail.grid || MINES_DEFAULT_GRID;
  const N = g * g;
  const m = detail.minesCount;
  const k = detail.revealed.length;
  const mult = k > 0 ? getMinesMultiplier(N, m, k) : 1;
  const safeLeft = N - m - k;
  const potential = Math.min(MINES_MAX_WIN, Math.floor(r.bet * mult));
  const nextList = getMinesNextMultipliers(N, m, k, 4);

  return {
    active: true,
    balance,
    bet: r.bet,
    step: r.step,
    grid: g,
    total_cells: N,
    mines: m,
    revealed: detail.revealed,
    safe_left: safeLeft,
    mult,
    potential,
    next_multipliers: nextList,
    server_seed_hash: r.server_seed_hash,
    client_seed: r.client_seed
  };
}

function minesStart(userId, bet, minesCount = 5, gridSize = 5, clientSeed = '') {
  checkBet(bet);
  const g = Number(gridSize) || MINES_DEFAULT_GRID;
  if (!MINES_GRIDS.includes(g)) throw new Error('INVALID');
  const N = g * g;
  const m = Number(minesCount);
  if (!Number.isInteger(m) || m < 1 || m > N - 1) throw new Error('INVALID');

  return db.transaction(() => {
    const existing = activeMinesRound(userId);
    if (existing) {
      const d = JSON.parse(existing.detail);
      if (d.revealed && d.revealed.length === 0) {
        // Refund untouched active round so user is never blocked
        postLedger({ userId, delta: existing.bet, type: 'refund', refType: 'round', refId: existing.id });
        db.prepare("UPDATE game_rounds SET status='done' WHERE id=?").run(existing.id);
      } else {
        throw new Error('ACTIVE_ROUND');
      }
    }

    const sSeed = crypto.randomBytes(32).toString('hex');
    const sHash = crypto.createHash('sha256').update(sSeed).digest('hex');
    const cSeed = String(clientSeed || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomBytes(16).toString('hex');
    const nonce = 1;

    const mines = generateMinesLayout(sSeed, cSeed, nonce, N, m);
    const detail = { grid: g, totalCells: N, mines, revealed: [], minesCount: m, nonce };
    const id = saveRound(userId, 'mines', bet, 0, detail, 'active', 0, sSeed, cSeed, sHash);
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    const nextList = getMinesNextMultipliers(N, m, 0, 4);

    return {
      active: true,
      balance,
      grid: g,
      total_cells: N,
      mines: m,
      safe_left: N - m,
      bet,
      revealed: [],
      mult: 1,
      potential: bet,
      next_multipliers: nextList,
      server_seed_hash: sHash,
      client_seed: cSeed
    };
  })();
}

function minesStep(userId, cell) {
  const c = Number(cell);
  return db.transaction(() => {
    const r = activeMinesRound(userId);
    if (!r) throw new Error('NOT_FOUND');
    const detail = JSON.parse(r.detail);
    const g = detail.grid || MINES_DEFAULT_GRID;
    const N = g * g;
    if (!Number.isInteger(c) || c < 0 || c >= N) throw new Error('INVALID');
    if (detail.revealed.includes(c)) throw new Error('INVALID');
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;

    if (detail.mines.includes(c)) {
      const info = db.prepare("UPDATE game_rounds SET status='done', payout=0 WHERE id=? AND status='active'").run(r.id);
      if (info.changes === 0) throw new Error('INVALID');
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
    const mult = getMinesMultiplier(N, m, k);
    const safeLeft = N - m - k;
    const potential = Math.min(MINES_MAX_WIN, Math.floor(r.bet * mult));
    const nextList = getMinesNextMultipliers(N, m, k, 4);

    if (safeLeft === 0) {
      // Auto cash-out when all safe tiles are revealed!
      const info = db.prepare("UPDATE game_rounds SET status='done', payout=?, step=?, detail=? WHERE id=? AND status='active'").run(potential, k, JSON.stringify(detail), r.id);
      if (info.changes === 0) throw new Error('INVALID');
      postLedger({ userId, delta: potential, type: 'win', refType: 'round', refId: r.id });
      const newBal = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
      return {
        result: 'safe',
        mine: false,
        tile: c,
        finished: true,
        safe_left: 0,
        multiplier: mult,
        mult,
        payout: potential,
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

    const info = db.prepare("UPDATE game_rounds SET step=?, detail=? WHERE id=? AND status='active'").run(k, JSON.stringify(detail), r.id);
    if (info.changes === 0) throw new Error('INVALID');
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
  })();
}

function minesCashout(userId) {
  return db.transaction(() => {
    const r = activeMinesRound(userId);
    if (!r || r.step < 1) throw new Error('INVALID');
    const detail = JSON.parse(r.detail);
    const g = detail.grid || MINES_DEFAULT_GRID;
    const N = g * g;
    const k = detail.revealed.length;
    if (k < 1) throw new Error('INVALID');
    const m = detail.minesCount;
    const mult = getMinesMultiplier(N, m, k);
    const payout = Math.min(MINES_MAX_WIN, Math.floor(r.bet * mult));

    const info = db.prepare("UPDATE game_rounds SET status='done', payout=? WHERE id=? AND status='active'").run(payout, r.id);
    if (info.changes === 0) throw new Error('INVALID');
    postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return {
      finished: true,
      payout,
      multiplier: mult,
      mult,
      balance,
      mines: detail.mines,
      server_seed: r.server_seed,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed,
      nonce: detail.nonce || 1
    };
  })();
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
const PLINKO_PAYOUTS = {
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

function plinko(userId, bet, rows = 10, risk = 'medium') {
  checkBet(bet);
  const rowCount = Number(rows) >= 8 && Number(rows) <= 16 ? Number(rows) : 10;
  const riskLevel = ['low', 'medium', 'high'].includes(risk) ? risk : 'medium';
  const table = PLINKO_PAYOUTS[rowCount] ? PLINKO_PAYOUTS[rowCount][riskLevel] : PLINKO_PAYOUTS[10].medium;

  return db.transaction(() => {
    const roundId = saveRound(userId, 'plinko', bet, 0, {});
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });

    const steps = [];
    let bucket = 0;
    for (let r = 0; r < rowCount; r++) {
      const step = rnd(2); // 0 = bounce left, 1 = bounce right
      steps.push(step);
      bucket += step;
    }

    const mult = table[bucket] !== undefined ? table[bucket] : 1;
    const payout = Math.floor(bet * mult);
    if (payout > 0) postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    db.prepare('UPDATE game_rounds SET payout=?, detail=? WHERE id=?')
      .run(payout, JSON.stringify({ bucket, mult, steps, rows: rowCount, risk: riskLevel }), roundId);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { bucket, mult, payout, balance, steps, rows: rowCount, risk: riskLevel };
  })();
}


// ---------- Keno (1-80, pick 1-10 spots, draw 20) ----------
// Payout table: [spots_picked][spots_matched] = multiplier
const KENO_PAY = {
  1:  { 1: 3.8 },
  2:  { 2: 12 },
  3:  { 2: 2, 3: 40 },
  4:  { 2: 1.5, 3: 5, 4: 100 },
  5:  { 3: 3, 4: 20, 5: 420 },
  6:  { 3: 2, 4: 8, 5: 80, 6: 1600 },
  7:  { 3: 1.5, 4: 5, 5: 25, 6: 320, 7: 7000 },
  8:  { 4: 3.5, 5: 12, 6: 100, 7: 1700, 8: 10000 },
  9:  { 4: 2.5, 5: 7, 6: 50, 7: 500, 8: 4000, 9: 30000 },
  10: { 5: 5, 6: 25, 7: 250, 8: 2000, 9: 10000, 10: 100000 },
};

function keno(userId, bet, picks) {
  checkBet(bet);
  const picksArr = (Array.isArray(picks) ? picks : []).map(Number);
  if (picksArr.length < 1 || picksArr.length > 10) throw new Error('INVALID');
  if (picksArr.some((n) => !Number.isInteger(n) || n < 1 || n > 80)) throw new Error('INVALID');
  if (new Set(picksArr).size !== picksArr.length) throw new Error('INVALID');

  return db.transaction(() => {
    const roundId = saveRound(userId, 'keno', bet, 0, {});
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });

    // Shuffle numbers 1-80, take first 20 drawn
    const pool = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const drawn = pool.slice(0, 20);

    const matched = picksArr.filter((p) => drawn.includes(p)).length;
    const payRow = KENO_PAY[picksArr.length] || {};
    const mult = payRow[matched] || 0;
    const payout = Math.floor(bet * mult);

    if (payout > 0) postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    db.prepare('UPDATE game_rounds SET payout=?, detail=? WHERE id=?')
      .run(payout, JSON.stringify({ picks: picksArr, drawn, matched, mult }), roundId);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { drawn, matched, mult, payout, balance };
  })();
}

// ---------- Ethiopian Bingo (ቢንጎ ሜዳ) ----------
// 5×5 card, numbers 1-75, FREE center, draw up to 75 numbers
// Columns: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
// Win conditions: row, column, diagonal, full card

function generateBingoCard() {
  const cols = [
    { start: 1,  end: 15 },   // B
    { start: 16, end: 30 },   // I
    { start: 31, end: 45 },   // N
    { start: 46, end: 60 },   // G
    { start: 61, end: 75 },   // O (ቢ-ን-ጎ)
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
  // Card is [col][row], center is col 2, row 2 = FREE
  card[2][2] = 0; // FREE
  return card; // card[col][row]
}

function checkBingoWin(marked, card) {
  // marked is flat 25-element bool array: row-major (i = col*5+row doesn't apply — use row*5+col)
  // We store marked[row][col] as flat marked[row*5+col]
  const m = (row, col) => row === 2 && col === 2 ? true : marked[row * 5 + col];

  // Rows
  for (let row = 0; row < 5; row++) {
    if ([0,1,2,3,4].every((col) => m(row, col))) return true;
  }
  // Columns
  for (let col = 0; col < 5; col++) {
    if ([0,1,2,3,4].every((row) => m(row, col))) return true;
  }
  // Diagonals
  if ([0,1,2,3,4].every((i) => m(i, i))) return true;
  if ([0,1,2,3,4].every((i) => m(i, 4 - i))) return true;
  return false;
}

function bingoStart(userId, bet) {
  checkBet(bet);
  return db.transaction(() => {
    // Cancel any existing active bingo round
    const existing = db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='bingo' AND status='active'").get(userId);
    if (existing) {
      db.prepare("UPDATE game_rounds SET status='done' WHERE id=?").run(existing.id);
    }
    const card = generateBingoCard();
    const detail = { card, drawn: [], marked: new Array(25).fill(false) };
    const id = saveRound(userId, 'bingo', bet, 0, detail, 'active', 0);
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { id, card, drawn: [], balance };
  })();
}

function bingoState(userId) {
  const r = db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='bingo' AND status='active'").get(userId);
  const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
  if (!r) return { active: false, balance };
  const detail = JSON.parse(r.detail);
  return { active: true, id: r.id, card: detail.card, drawn: detail.drawn, marked: detail.marked, bet: r.bet, balance };
}

function bingoCall(userId) {
  return db.transaction(() => {
    const r = db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='bingo' AND status='active'").get(userId);
    if (!r) throw new Error('NOT_FOUND');
    const detail = JSON.parse(r.detail);

    // Draw a number not yet drawn
    const remaining = [];
    for (let n = 1; n <= 75; n++) {
      if (!detail.drawn.includes(n)) remaining.push(n);
    }
    if (remaining.length === 0) throw new Error('INVALID'); // all drawn

    const idx = rnd(remaining.length);
    const called = remaining[idx];
    detail.drawn.push(called);

    // Auto-mark on card: card[col][row], marked[row*5+col]
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 5; row++) {
        if (detail.card[col][row] === called) {
          detail.marked[row * 5 + col] = true;
        }
      }
    }

    // Check win
    const won = checkBingoWin(detail.marked, detail.card);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;

    if (won) {
      // Payout scales with draws: fewer draws = higher multiplier
      const drawCount = detail.drawn.length;
      const mult = drawCount <= 20 ? 15 : drawCount <= 30 ? 8 : drawCount <= 40 ? 4 : drawCount <= 50 ? 2.5 : 1.5;
      const payout = Math.floor(r.bet * mult);
      postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
      db.prepare("UPDATE game_rounds SET status='done', payout=?, detail=? WHERE id=?")
        .run(payout, JSON.stringify(detail), r.id);
      const newBal = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
      return { called, drawn: detail.drawn, marked: detail.marked, won: true, payout, mult, balance: newBal };
    }

    db.prepare("UPDATE game_rounds SET step=step+1, detail=? WHERE id=?")
      .run(JSON.stringify(detail), r.id);
    return { called, drawn: detail.drawn, marked: detail.marked, won: false, balance };
  })();
}

function bingoAbandon(userId) {
  return db.transaction(() => {
    const r = db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='bingo' AND status='active'").get(userId);
    if (!r) return {};
    db.prepare("UPDATE game_rounds SET status='done' WHERE id=?").run(r.id);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { balance };
  })();
}

module.exports = {
  roulette,
  starSpin,
  roadState,
  roadStart,
  roadStep,
  roadCashout,
  roadHistory,
  roadVerify,
  ROAD_CONFIG,
  minesState,
  minesStart,
  minesStep,
  minesCashout,
  minesVerify,
  MINES_GRIDS,
  getMinesMultiplier,
  getMinesNextMultipliers,
  generateMinesLayout,
  plinko,
  keno,
  bingoStart,
  bingoState,
  bingoCall,
  bingoAbandon,
  MIN_BET,
  MAX_BET,
  KENO_PAY,
};
