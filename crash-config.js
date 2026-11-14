'use strict';

// Rocket Crash — single source of truth for server-side tunable defaults.
// Every value marked DEFAULT in the brief lives here as a documented constant.
// Money is integer santim (1 ETB = 100 santim). Multipliers are integer
// hundredths (248 = 2.48x). No floating point money is allowed anywhere.
const GAME_NAME = 'Rocket Crash'; // DEFAULT working title (owner decision)
const GAME_SLUG = 'crash';
const FORMULA_VERSION = 'crash-v1';

// Round timing.
const BETTING_MS = 6000; // DEFAULT betting window
const CRASHED_MS = 3000; // DEFAULT crash-result display before the next window

// Multiplier growth and house edge.
const GROWTH_K_MICRO = 87000; // DEFAULT K = 0.087, stored as K * 1,000,000
const EDGE_BP = 300; // DEFAULT 3.00% edge (97% nominal RTP, owner decision)
const MAX_HUNDREDTHS = 100000; // DEFAULT 1000.00x hard cap
const MIN_CRASH_HUNDREDTHS = 100; // 1.00x floor; a crash can never be below it

// Stakes and payouts.
const MIN_STAKE_SANTIM = 100; // DEFAULT 1.00 ETB
const MAX_STAKE_SANTIM = 100000; // DEFAULT 1,000.00 ETB
const MAX_WIN_SANTIM = 1000000; // DEFAULT 10,000.00 ETB per bet
const MIN_AUTO_CASHOUT_HUNDREDTHS = 101; // 1.01x (target 1.00x would be a refund)
const PANELS = Object.freeze([1, 2]); // DEFAULT two independent bets per user

// Request validation.
const REQUEST_ID_MIN_LENGTH = 8;
const REQUEST_ID_MAX_LENGTH = 64;
const MAX_STAKE_DIGITS = 9;

// Public feed and history.
const DISPLAY_BETS_LIMIT = 50; // DEFAULT top 50 bets of the displayed round
const STATE_HISTORY_LIMIT = 20; // crashed results carried in /state
const STRIP_LENGTH = 10; // DEFAULT last 10 crash multipliers in the strip
const RED_PILL_THRESHOLD_HUNDREDTHS = 1000; // DEFAULT >= 10.00x renders red
const TROPHY_MEANING = 'largest single payout of the displayed round';

// Network and streaming.
const TICK_MS = 250; // server-time / multiplier drift correction
const SSE_HEARTBEAT_MS = 15000;
const SSE_MAX_PER_USER = 4; // DEFAULT concurrent streams per customer
const SSE_GLOBAL_MAX = 2000; // DEFAULT process-wide stream cap
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 10; // DEFAULT per user per second
const ENGINE_POLL_MS = 250; // retry backoff for transient engine work
const ADVISORY_LOCK_KEY = 726310001; // stable pg advisory-lock key for the loop
const CRASH_ENABLED_DEFAULT = true; // DEFAULT kill-switch state

// Wallet ledger conventions reused from the existing games.
const GAME_ROUND_GAME = 'crash';
const LEDGER_DEBIT_TYPE = 'bet';
const LEDGER_CREDIT_TYPE = 'win';
const LEDGER_REF_TYPE = 'round';
const GAME_ROUND_ACTIVE_STATUS = 'active';
const GAME_ROUND_DONE_STATUS = 'done';

// Auto cash-out scheduling.
const AUTO_SETTLE_CONCURRENCY = 8; // DEFAULT bounded parallelism per batch
const AUTO_SETTLE_MAX_ATTEMPTS = 3;

// Front-end transport fallback.
const POLL_MS = 500; // fallback snapshot polling after three stream failures
const STREAM_BACKOFF_MS = Object.freeze([1000, 2000, 4000, 8000, 15000]);

module.exports = Object.freeze({
  GAME_NAME,
  GAME_SLUG,
  FORMULA_VERSION,
  BETTING_MS,
  CRASHED_MS,
  GROWTH_K_MICRO,
  EDGE_BP,
  MAX_HUNDREDTHS,
  MIN_CRASH_HUNDREDTHS,
  MIN_STAKE_SANTIM,
  MAX_STAKE_SANTIM,
  MAX_WIN_SANTIM,
  MIN_AUTO_CASHOUT_HUNDREDTHS,
  PANELS,
  REQUEST_ID_MIN_LENGTH,
  REQUEST_ID_MAX_LENGTH,
  MAX_STAKE_DIGITS,
  DISPLAY_BETS_LIMIT,
  STATE_HISTORY_LIMIT,
  STRIP_LENGTH,
  RED_PILL_THRESHOLD_HUNDREDTHS,
  TROPHY_MEANING,
  TICK_MS,
  SSE_HEARTBEAT_MS,
  SSE_MAX_PER_USER,
  SSE_GLOBAL_MAX,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  ENGINE_POLL_MS,
  ADVISORY_LOCK_KEY,
  CRASH_ENABLED_DEFAULT,
  GAME_ROUND_GAME,
  LEDGER_DEBIT_TYPE,
  LEDGER_CREDIT_TYPE,
  LEDGER_REF_TYPE,
  GAME_ROUND_ACTIVE_STATUS,
  GAME_ROUND_DONE_STATUS,
  AUTO_SETTLE_CONCURRENCY,
  AUTO_SETTLE_MAX_ATTEMPTS,
  POLL_MS,
  STREAM_BACKOFF_MS
});
