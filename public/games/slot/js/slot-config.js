'use strict';

const SYMBOLS = Object.freeze([
  { id: 'heart', kind: 'low', label: 'Heart', glyph: '♥' },
  { id: 'diamond', kind: 'low', label: 'Diamond', glyph: '♦' },
  { id: 'spade', kind: 'low', label: 'Spade', glyph: '♠' },
  { id: 'club', kind: 'low', label: 'Club', glyph: '♣' },
  { id: 'seven', kind: 'high', label: 'Seven', glyph: '7' },
  { id: 'bar', kind: 'high', label: 'Bar', glyph: 'BAR' },
  { id: 'bell', kind: 'high', label: 'Bell', glyph: '♟' },
  { id: 'wild', kind: 'wild', label: 'Wild', glyph: '★' },
]);
const REEL_COUNT = 5;

const PAYLINES = Object.freeze([
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 2],
].map((line) => Object.freeze(line)));

const BASE_REEL_WEIGHTS = Object.freeze([41, 41, 41, 41, 36, 24, 24, 8]);
const REEL_STOP_COUNT = 256;

function buildReelStrip(weights, phase) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total !== REEL_STOP_COUNT) throw new Error('Every slot reel must have 256 weighted stops.');
  return Object.freeze(Array.from({ length: total }, (_, index) => {
    let weightedStop = (index * 73 + phase * 29) % total;
    for (let symbolIndex = 0; symbolIndex < weights.length; symbolIndex++) {
      if (weightedStop < weights[symbolIndex]) return SYMBOLS[symbolIndex].id;
      weightedStop -= weights[symbolIndex];
    }
    throw new Error('Invalid slot reel weight.');
  }));
}

const REELS = Object.freeze(Array.from({ length: REEL_COUNT }, (_, index) => Object.freeze({
  weights: Object.freeze(Object.fromEntries(SYMBOLS.map((symbol, symbolIndex) => [symbol.id, BASE_REEL_WEIGHTS[symbolIndex]]))),
  strip: buildReelStrip(BASE_REEL_WEIGHTS, index),
})));

const PAYTABLE = Object.freeze({
  heart: Object.freeze({ 3: 4200, 4: 13900, 5: 104300 }),
  diamond: Object.freeze({ 3: 4200, 4: 13900, 5: 104300 }),
  spade: Object.freeze({ 3: 4200, 4: 13900, 5: 104300 }),
  club: Object.freeze({ 3: 4200, 4: 13900, 5: 104300 }),
  seven: Object.freeze({ 3: 7000, 4: 23400, 5: 159000 }),
  bar: Object.freeze({ 3: 11100, 4: 33400, 5: 228400 }),
  bell: Object.freeze({ 3: 11100, 4: 33400, 5: 228400 }),
  wild: Object.freeze({ 3: 19500, 4: 279000, 5: 836500 }),
});

const SLOT_CONFIG = Object.freeze({
  GAME_SLUG: 'slot',
  GAME_TITLE: 'Lucky Royale',
  DEFAULT_LANGUAGE: 'am',
  ROWS: 3,
  REEL_COUNT,
  SYMBOLS,
  PAYLINES,
  REEL_STOP_COUNT,
  REELS,
  PAYTABLE,
  PAYOUT_MULTIPLIER_SCALE: 10000,
  RTP_TARGET_PERCENT: 40,
  HOUSE_EDGE_PERCENT: 60,
  HIT_RATE_MIN_PERCENT: 25,
  HIT_RATE_MAX_PERCENT: 30,
  MAX_WIN_MULTIPLIER: 1000,
  MIN_BET_SANTIM: 100,
  MAX_BET_SANTIM: 100000,
  DEFAULT_BET_SANTIM: 100,
  BET_STEP_SANTIM: 100,
  QUICK_BETS_SANTIM: Object.freeze([100, 500, 1000, 2500, 5000, 10000]),
  MAX_HISTORY_SPINS: 20,
  SEED_EPOCH_SPINS: 50,
  SIMULATION_SPINS: 2000000,
  SIMULATION_SEED: 20261114,
  SPIN_BASE_MS: 1400,
  SPIN_REEL_STEP_MS: 280,
  SPIN_SYMBOL_STEPS: 20,
  SPIN_REEL_STEP_SYMBOLS: 6,
  REEL_ACCEL_MS: 220,
  REEL_DECEL_MS: 320,
  REEL_OVERSHOOT_PX: 7,
  REEL_BOUNCE_MS: 120,
  TURBO_DURATION_DIVISOR: 2,
  WIN_COUNT_MS: 900,
  WIN_BANNER_MS: 2100,
  COIN_BURST_MS: 1100,
  BIG_WIN_MULTIPLE: 15,
  MEGA_WIN_MULTIPLE: 50,
  COIN_BURST_COUNT: 18,
  AUTO_SPIN_DELAY_MS: 180,
  AUTO_COUNTS: Object.freeze([10, 25, 50, 100]),
  AUTO_DEFAULT_COUNT: 10,
  AUTO_STOP_ON_BALANCE_DEFAULT: true,
  AUTO_STOP_ON_BIG_WIN_DEFAULT: true,
  AUTO_STOP_ON_SINGLE_LOSS_DEFAULT: true,
  TURBO_DEFAULT: false,
  SOUND_DEFAULT: false,
  MOCK_BALANCE_SANTIM: 100000,
  SPIN_RATE_WINDOW_MS: 60000,
  SPIN_RATE_MAX_REQUESTS: 30,
  MATH_VERSION: 1,
  FAIRNESS_VERSION: 1,
  FAIRNESS_ALGORITHM: 'HMAC-SHA256 keyed by the 32-byte server seed; message client_seed:nonce:reel:slot:v1; digest byte 0 selects each 0–255 stop. Commitments are SHA-256 of the raw server seed bytes.',
});

if (typeof module !== 'undefined' && module.exports) module.exports = SLOT_CONFIG;
if (typeof window !== 'undefined') window.SLOT_CONFIG = SLOT_CONFIG;
