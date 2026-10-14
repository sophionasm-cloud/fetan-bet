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
function saveRound(userId, game, bet, payout, detail, status = 'done', step = 0) {
  return Number(db.prepare('INSERT INTO game_rounds (user_id, game, bet, payout, step, status, detail) VALUES (?,?,?,?,?,?,?)')
    .run(userId, game, bet, payout, step, status, JSON.stringify(detail)).lastInsertRowid);
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

// ---------- Road Dash (cross-the-road, cash out any time) ----------
const SURVIVE = 80;   // % chance to survive each lane
const MAX_STEPS = 10;
const multAt = (step) => Math.floor((0.96 / Math.pow(SURVIVE / 100, step)) * 100) / 100;

function activeRound(userId) {
  return db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='road' AND status='active'").get(userId);
}
const LADDER = Array.from({ length: MAX_STEPS }, (_, i) => multAt(i + 1));
function roadState(userId) {
  const r = activeRound(userId);
  const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
  if (!r) return { active: false, balance, ladder: LADDER, maxSteps: MAX_STEPS };
  return { active: true, step: r.step, bet: r.bet, mult: r.step ? multAt(r.step) : 0, next: multAt(r.step + 1), balance, maxSteps: MAX_STEPS, ladder: LADDER };
}
function roadStart(userId, bet) {
  checkBet(bet);
  return db.transaction(() => {
    if (activeRound(userId)) throw new Error('ACTIVE_ROUND');
    const id = saveRound(userId, 'road', bet, 0, {}, 'active', 0);
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    return roadState(userId);
  })();
}
function roadPayout(r, userId) {
  const payout = Math.floor(r.bet * multAt(r.step));
  postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
  db.prepare("UPDATE game_rounds SET status='done', payout=? WHERE id=?").run(payout, r.id);
  return payout;
}
function roadStep(userId) {
  return db.transaction(() => {
    const r = activeRound(userId);
    if (!r) throw new Error('NOT_FOUND');
    const alive = rnd(100) < SURVIVE;
    if (!alive) {
      db.prepare("UPDATE game_rounds SET status='done', payout=0 WHERE id=?").run(r.id);
      return { crashed: true, step: r.step + 1, ...roadState(userId) };
    }
    db.prepare('UPDATE game_rounds SET step = step + 1 WHERE id=?').run(r.id);
    const r2 = { ...r, step: r.step + 1 };
    if (r2.step >= MAX_STEPS) {
      const payout = roadPayout(r2, userId);
      return { crashed: false, finished: true, payout, ...roadState(userId) };
    }
    return { crashed: false, ...roadState(userId) };
  })();
}
function roadCashout(userId) {
  return db.transaction(() => {
    const r = activeRound(userId);
    if (!r || r.step < 1) throw new Error('INVALID');
    const payout = roadPayout(r, userId);
    return { payout, ...roadState(userId) };
  })();
}

// ---------- Mines (5x5 grid diamond hunt) ----------
function activeMinesRound(userId) {
  return db.prepare("SELECT * FROM game_rounds WHERE user_id=? AND game='mines' AND status='active'").get(userId);
}

function minesState(userId) {
  const r = activeMinesRound(userId);
  const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
  if (!r) return { active: false, balance, mines: 5 };
  const detail = JSON.parse(r.detail);
  const k = detail.revealed.length;
  const m = detail.minesCount;
  const fair = k > 0 ? comb(25, k) / comb(25 - m, k) : 1;
  const mult = k > 0 ? Math.max(1.05, Math.floor(0.96 * fair * 100) / 100) : 1;
  const safeLeft = 25 - m - k;
  const potential = Math.floor(r.bet * mult);
  return {
    active: true,
    balance,
    bet: r.bet,
    step: r.step,
    mines: m,
    revealed: detail.revealed,
    safe_left: safeLeft,
    mult,
    potential
  };
}

function minesStart(userId, bet, minesCount = 5) {
  checkBet(bet);
  const m = Number(minesCount);
  if (!Number.isInteger(m) || m < 1 || m > 24) throw new Error('INVALID');
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
    const all = Array.from({ length: 25 }, (_, i) => i);
    for (let i = all.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    const mines = all.slice(0, m);
    const detail = { mines, revealed: [], minesCount: m };
    const id = saveRound(userId, 'mines', bet, 0, detail, 'active', 0);
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { active: true, balance, mines: m, safe_left: 25 - m, bet, revealed: [], mult: 1, potential: bet };
  })();
}

function minesStep(userId, cell) {
  const c = Number(cell);
  if (!Number.isInteger(c) || c < 0 || c > 24) throw new Error('INVALID');
  return db.transaction(() => {
    const r = activeMinesRound(userId);
    if (!r) throw new Error('NOT_FOUND');
    const detail = JSON.parse(r.detail);
    if (detail.revealed.includes(c)) throw new Error('INVALID');
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;

    if (detail.mines.includes(c)) {
      db.prepare("UPDATE game_rounds SET status='done', payout=0 WHERE id=?").run(r.id);
      return { mine: true, mines: detail.mines, balance };
    }

    detail.revealed.push(c);
    const k = detail.revealed.length;
    const m = detail.minesCount;
    const fair = comb(25, k) / comb(25 - m, k);
    const mult = Math.max(1.05, Math.floor(0.96 * fair * 100) / 100);
    const safeLeft = 25 - m - k;
    const potential = Math.floor(r.bet * mult);

    if (safeLeft === 0) {
      postLedger({ userId, delta: potential, type: 'win', refType: 'round', refId: r.id });
      db.prepare("UPDATE game_rounds SET status='done', payout=?, step=?, detail=? WHERE id=?").run(potential, k, JSON.stringify(detail), r.id);
      const newBal = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
      return { mine: false, safe_left: 0, mult, payout: potential, potential, balance: newBal, mines: detail.mines };
    }

    db.prepare("UPDATE game_rounds SET step=?, detail=? WHERE id=?").run(k, JSON.stringify(detail), r.id);
    return { mine: false, safe_left: safeLeft, mult, potential, balance };
  })();
}

function minesCashout(userId) {
  return db.transaction(() => {
    const r = activeMinesRound(userId);
    if (!r || r.step < 1) throw new Error('INVALID');
    const detail = JSON.parse(r.detail);
    const k = detail.revealed.length;
    const m = detail.minesCount;
    const fair = comb(25, k) / comb(25 - m, k);
    const mult = Math.max(1.05, Math.floor(0.96 * fair * 100) / 100);
    const payout = Math.floor(r.bet * mult);
    postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: r.id });
    db.prepare("UPDATE game_rounds SET status='done', payout=? WHERE id=?").run(payout, r.id);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { payout, mult, balance, mines: detail.mines };
  })();
}

// ---------- Plinko (10 rows, 11 buckets) ----------
const PLINKO_ROWS = 10;
const PLINKO_MULTS = [8, 3, 1.5, 0.7, 0.4, 0.3, 0.4, 0.7, 1.5, 3, 8];

function plinko(userId, bet) {
  checkBet(bet);
  return db.transaction(() => {
    const roundId = saveRound(userId, 'plinko', bet, 0, {});
    postLedger({ userId, delta: -bet, type: 'bet', refType: 'round', refId: roundId });

    const steps = [];
    let bucket = 0;
    for (let r = 0; r < PLINKO_ROWS; r++) {
      const step = rnd(2); // 0 = bounce left, 1 = bounce right
      steps.push(step);
      bucket += step;
    }

    const mult = PLINKO_MULTS[bucket];
    const payout = Math.floor(bet * mult);
    if (payout > 0) postLedger({ userId, delta: payout, type: 'win', refType: 'round', refId: roundId });
    db.prepare('UPDATE game_rounds SET payout=?, detail=? WHERE id=?').run(payout, JSON.stringify({ bucket, mult, steps }), roundId);
    const balance = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId).balance;
    return { bucket, mult, payout, balance, steps };
  })();
}

module.exports = {
  roulette,
  starSpin,
  roadState,
  roadStart,
  roadStep,
  roadCashout,
  minesState,
  minesStart,
  minesStep,
  minesCashout,
  plinko,
  MIN_BET,
  MAX_BET
};
