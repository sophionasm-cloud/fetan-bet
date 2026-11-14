'use strict';

// B2B Bomber crash mathematics.
//
// Target player RTP is 40% (house edge 60%). For a cash-out target X
// (integer hundredths, X > 100) the design probability of reaching X is
// 40 / X. The crash multiplier is generated from a 256-bit uniform value h:
//
//   crashHundredths = max(100, floor(40 * 2^256 / (2^256 - h)))
//
// All outcome arithmetic uses BigInt. Money is integer santim (1 ETB = 100).
const crypto = require('node:crypto');

const MATH_VERSION = 1;
const FAIRNESS_VERSION = 1;
const ENGINE_VERSION = 1;

const RTP_NUMERATOR = 40n;          // 40% expressed in hundredths
const RTP_PERCENT = 40;
const HOUSE_EDGE_PERCENT = 60;

const UNIFORM_SPACE = 1n << 256n;   // N = 2^256
const MULTIPLIER_SCALE = 100n;      // hundredths of a multiplier
const MIN_CRASH_HUNDREDTHS = 100n;  // 1.00x
const MAX_CRASH_HUNDREDTHS = 10000n; // 100.00x documented cap
const MAX_MULTIPLIER = 100;         // display value for the cap

const MIN_BET_SANTIM = 100;         // 1 ETB
const MAX_BET_SANTIM = 100000;      // 1,000 ETB

const COUNTDOWN_MS = 3000;
const TAKEOFF_MS = 900;
// Multiplier doubles every 7 seconds after take-off. Any strictly increasing
// curve works; this one keeps a 100x flight under a minute. The rate is per
// millisecond.
const CURVE_DOUBLE_MS = 7000;
const CURVE_RATE = Math.log(2) / CURVE_DOUBLE_MS;

const SERVER_SEED_BYTES = 32;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUniform(h) {
  if (typeof h !== 'bigint' || h < 0n || h >= UNIFORM_SPACE) {
    throw new TypeError('h must be a 256-bit unsigned integer');
  }
}

// Exact crash multiplier for a uniform value. BigInt throughout.
function crashHundredthsFromUniform(h) {
  assertUniform(h);
  const raw = (RTP_NUMERATOR * UNIFORM_SPACE) / (UNIFORM_SPACE - h);
  if (raw < MIN_CRASH_HUNDREDTHS) return Number(MIN_CRASH_HUNDREDTHS);
  if (raw > MAX_CRASH_HUNDREDTHS) return Number(MAX_CRASH_HUNDREDTHS);
  return Number(raw);
}

function sanitizeClientSeed(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function clientSeedForRound(value) {
  return sanitizeClientSeed(value) || crypto.randomBytes(16).toString('hex');
}

function normalizeServerSeed(serverSeed) {
  if (Buffer.isBuffer(serverSeed)) {
    if (serverSeed.length !== SERVER_SEED_BYTES) throw new TypeError('Server seed must be 32 bytes');
    return serverSeed;
  }
  const text = String(serverSeed ?? '');
  if (!/^[0-9a-f]{64}$/i.test(text)) throw new TypeError('Server seed must be 64 hex characters');
  return Buffer.from(text, 'hex');
}

function commitServerSeed(serverSeed) {
  return crypto.createHash('sha256').update(normalizeServerSeed(serverSeed)).digest('hex');
}

// Uniform 256-bit value for one round. The server seed is fresh for every
// round, so the nonce is a documented uniqueness field (the round id) rather
// than a seed-reuse counter.
function uniformFromSeed(serverSeed, clientSeed, nonce) {
  const seed = normalizeServerSeed(serverSeed);
  const normalizedNonce = String(nonce ?? '');
  if (!normalizedNonce || normalizedNonce.length > 80) throw new TypeError('Nonce is required');
  const message = `${sanitizeClientSeed(clientSeed)}:${normalizedNonce}:b2b-bomber:v${MATH_VERSION}`;
  const digest = crypto.createHmac('sha256', seed).update(message).digest('hex');
  return BigInt('0x' + digest);
}

function crashFromSeed(serverSeed, clientSeed, nonce) {
  const h = uniformFromSeed(serverSeed, clientSeed, nonce);
  return {
    uniform_hex: h.toString(16).padStart(64, '0'),
    crash_hundredths: crashHundredthsFromUniform(h),
  };
}

// Exact number of h values in [0, N) for which the crash reaches X.
// For X > 100 this is floor(40N / X); the floor is why realized probability is
// a hair below 40/X rather than exactly equal to it.
function reachCount(hundredths) {
  const x = BigInt(hundredths);
  if (x <= 0n) return 0n;
  if (x <= 100n) return UNIFORM_SPACE;
  if (x > MAX_CRASH_HUNDREDTHS) return 0n;
  return (RTP_NUMERATOR * UNIFORM_SPACE) / x;
}

function reachProbability(hundredths) {
  return { numerator: reachCount(hundredths), denominator: UNIFORM_SPACE };
}

function immediateCrashCount() {
  return UNIFORM_SPACE - reachCount(101);
}

// Gross payout in santim for a cash-out target. Integer floor, never float.
function payoutSantim(stakeSantim, multiplierHundredths) {
  if (!Number.isSafeInteger(stakeSantim) || stakeSantim < 0) {
    throw new TypeError('Stake must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(multiplierHundredths) || multiplierHundredths < 0) {
    throw new TypeError('Multiplier must be a non-negative safe integer');
  }
  const payout = (BigInt(stakeSantim) * BigInt(multiplierHundredths)) / MULTIPLIER_SCALE;
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PAYOUT_LIMIT');
  return Number(payout);
}

function expectedRtp(stakeSantim, multiplierHundredths) {
  const payout = payoutSantim(stakeSantim, multiplierHundredths);
  const count = reachCount(multiplierHundredths);
  return {
    numerator: BigInt(payout) * count,
    denominator: BigInt(stakeSantim) * UNIFORM_SPACE,
  };
}

function ratioToDecimal(numerator, denominator, digits = 12) {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n) {
    throw new TypeError('BigInt numerator and positive denominator required');
  }
  const scale = 10n ** BigInt(digits);
  const scaled = (numerator * scale) / denominator;
  const whole = scaled / scale;
  const fraction = String(scaled % scale).padStart(digits, '0');
  return `${whole}.${fraction}`;
}

function probabilityPercent(hundredths, digits = 8) {
  const { numerator, denominator } = reachProbability(hundredths);
  return ratioToDecimal(numerator * 100n, denominator, digits);
}

// ---------- Flight presentation ----------

// Continuous display curve, only used to describe where the flight is. The
// outcome itself never depends on elapsed time: it is fixed by the seed.
function multiplierHundredthsAtElapsed(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 100;
  const value = Math.floor(Math.exp(CURVE_RATE * elapsedMs) * 100);
  return Math.min(Number.MAX_SAFE_INTEGER, value);
}

function timeToHundredths(hundredths) {
  const value = Number(hundredths);
  if (!Number.isFinite(value) || value <= 100) return 0;
  return Math.max(0, Math.ceil(Math.log(value / 100) / CURVE_RATE));
}

function flightDurationMs(crashHundredths) {
  const crash = Number(crashHundredths);
  if (!Number.isFinite(crash) || crash <= 100) return 0;
  if (crash > MAX_MULTIPLIER * 100) throw new RangeError('Crash above cap');
  return timeToHundredths(crash);
}

// The crash is shown one hundredth after the final reachable multiplier. This
// keeps the last tick (for example 2.00x) on screen long enough for a manual
// cash-out, which makes success exactly "crash >= target" and preserves the
// 40/X probability for both manual and automatic cash-out.
function crashAfterMs(crashHundredths) {
  const crash = Number(crashHundredths);
  if (!Number.isFinite(crash) || crash < 100) throw new RangeError('Invalid crash multiplier');
  return timeToHundredths(crash + 1);
}

function timingFor(crashHundredths, nowMs = Date.now()) {
  const startsAt = nowMs + COUNTDOWN_MS;
  const flightStartedAt = startsAt + TAKEOFF_MS;
  const crashAt = flightStartedAt + crashAfterMs(crashHundredths);
  return { starts_at: startsAt, flight_started_at: flightStartedAt, crash_at: crashAt };
}

function currentHundredths(nowMs, flightStartedAt, crashHundredths) {
  const crash = Number(crashHundredths);
  if (nowMs < flightStartedAt) return 100;
  const elapsed = nowMs - flightStartedAt;
  if (elapsed >= crashAfterMs(crash)) return crash;
  return Math.max(100, Math.min(multiplierHundredthsAtElapsed(elapsed), crash));
}

function isValidAutoTarget(value) {
  return Number.isInteger(value) && value >= 101 && value <= MAX_MULTIPLIER * 100;
}

function isValidBet(value) {
  return Number.isSafeInteger(value) && value >= MIN_BET_SANTIM && value <= MAX_BET_SANTIM;
}

module.exports = {
  MATH_VERSION,
  FAIRNESS_VERSION,
  ENGINE_VERSION,
  RTP_NUMERATOR,
  RTP_PERCENT,
  HOUSE_EDGE_PERCENT,
  UNIFORM_SPACE,
  MULTIPLIER_SCALE,
  MIN_CRASH_HUNDREDTHS,
  MAX_CRASH_HUNDREDTHS,
  MAX_MULTIPLIER,
  MIN_BET_SANTIM,
  MAX_BET_SANTIM,
  COUNTDOWN_MS,
  TAKEOFF_MS,
  CURVE_DOUBLE_MS,
  SERVER_SEED_BYTES,
  UUID_PATTERN,
  assertUniform,
  crashHundredthsFromUniform,
  sanitizeClientSeed,
  clientSeedForRound,
  normalizeServerSeed,
  commitServerSeed,
  uniformFromSeed,
  crashFromSeed,
  reachCount,
  reachProbability,
  immediateCrashCount,
  payoutSantim,
  expectedRtp,
  ratioToDecimal,
  probabilityPercent,
  multiplierHundredthsAtElapsed,
  timeToHundredths,
  flightDurationMs,
  crashAfterMs,
  timingFor,
  currentHundredths,
  isValidAutoTarget,
  isValidBet,
};
