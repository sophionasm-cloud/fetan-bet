'use strict';

const SLOT_MATH_CONFIG = typeof module !== 'undefined' && module.exports
  ? require('./slot-config')
  : window.SLOT_CONFIG;
const WILD = 'wild';
const VALID_SYMBOLS = new Set(SLOT_MATH_CONFIG.SYMBOLS.map((symbol) => symbol.id));

function isValidBet(bet) {
  return Number.isSafeInteger(bet) && bet >= SLOT_MATH_CONFIG.MIN_BET_SANTIM && bet <= SLOT_MATH_CONFIG.MAX_BET_SANTIM;
}

function assertBet(bet) {
  if (!isValidBet(bet)) throw new Error('INVALID');
}

function gridFromStops(stops) {
  if (!Array.isArray(stops) || stops.length !== SLOT_MATH_CONFIG.REEL_COUNT ||
      stops.some((stop) => !Number.isInteger(stop) || stop < 0 || stop >= SLOT_MATH_CONFIG.REEL_STOP_COUNT)) {
    throw new Error('INVALID_STOPS');
  }
  return Array.from({ length: SLOT_MATH_CONFIG.ROWS }, (_, row) =>
    stops.map((stop, reel) => SLOT_MATH_CONFIG.REELS[reel].strip[(stop + row) % SLOT_MATH_CONFIG.REEL_STOP_COUNT])
  );
}

function assertGrid(grid) {
  if (!Array.isArray(grid) || grid.length !== SLOT_MATH_CONFIG.ROWS || grid.some((row) =>
    !Array.isArray(row) || row.length !== SLOT_MATH_CONFIG.REEL_COUNT || row.some((symbol) => !VALID_SYMBOLS.has(symbol)))) {
    throw new Error('INVALID_GRID');
  }
}

function lineSymbols(grid, lineIndex) {
  const rows = SLOT_MATH_CONFIG.PAYLINES[lineIndex];
  return rows.map((row, reel) => grid[row][reel]);
}

function rawLineWin(symbols, lineIndex, bet) {
  let target = symbols.find((symbol) => symbol !== WILD) || WILD;
  let count = 0;
  for (const symbol of symbols) {
    if (symbol !== target && symbol !== WILD) break;
    count++;
  }
  if (count < 3) return null;
  return {
    line: lineIndex + 1,
    symbol: target,
    count,
    payout: Math.floor(bet * SLOT_MATH_CONFIG.PAYTABLE[target][count] / SLOT_MATH_CONFIG.PAYOUT_MULTIPLIER_SCALE),
  };
}

function capWins(rawWins, maxPayout) {
  let remaining = maxPayout;
  const wins = [];
  for (const win of rawWins) {
    if (remaining <= 0) break;
    const payout = Math.min(win.payout, remaining);
    wins.push({ ...win, payout });
    remaining -= payout;
  }
  return wins;
}

function evaluateGrid(grid, bet) {
  assertBet(bet);
  assertGrid(grid);
  const rawWins = [];
  for (let lineIndex = 0; lineIndex < SLOT_MATH_CONFIG.PAYLINES.length; lineIndex++) {
    const win = rawLineWin(lineSymbols(grid, lineIndex), lineIndex, bet);
    if (win) rawWins.push(win);
  }
  const maxPayout = bet * SLOT_MATH_CONFIG.MAX_WIN_MULTIPLIER;
  const wins = capWins(rawWins, maxPayout);
  return { wins, totalPayout: wins.reduce((sum, win) => sum + win.payout, 0) };
}

function evaluateStops(stops, bet) {
  const grid = gridFromStops(stops);
  return { grid, ...evaluateGrid(grid, bet) };
}

const SLOT_MATH = Object.freeze({ isValidBet, gridFromStops, evaluateGrid, evaluateStops, lineSymbols, capWins });
if (typeof module !== 'undefined' && module.exports) module.exports = SLOT_MATH;
if (typeof window !== 'undefined') window.SLOT_MATH = SLOT_MATH;
