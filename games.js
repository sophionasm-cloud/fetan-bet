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
  minesState,
  minesStart,
  minesStep,
  minesCashout,
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
