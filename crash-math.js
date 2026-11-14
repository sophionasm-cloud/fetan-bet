'use strict';

// Rocket Crash pure math. No database, network or wallet access.
// All monetary values are integer santim; all multipliers are integer
// hundredths. The provably-fair formula uses BigInt end to end.
const crypto = require('node:crypto');
const C = require('./crash-config');

const TWO_52 = 1n << 52n;
const HEX_64 = /^[0-9a-f]{64}$/i;
const HEX_13 = /^[0-9a-f]{13}$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

function generateClientSeed() {
  return crypto.randomBytes(16).toString('hex');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function serverSeedHash(serverSeed) {
  if (typeof serverSeed !== 'string' || !HEX_64.test(serverSeed)) {
    throw new Error('INVALID_SEED');
  }
  return sha256Hex(serverSeed);
}

function hmacHex(serverSeed, message) {
  return crypto.createHmac('sha256', Buffer.from(String(serverSeed), 'utf8'))
    .update(String(message), 'utf8')
    .digest('hex');
}

function clampHundredths(value, maxHundredths = C.MAX_HUNDREDTHS) {
  const max = Number.isSafeInteger(maxHundredths) && maxHundredths >= C.MIN_CRASH_HUNDREDTHS
    ? maxHundredths
    : C.MAX_HUNDREDTHS;
  if (value < C.MIN_CRASH_HUNDREDTHS) return C.MIN_CRASH_HUNDREDTHS;
  if (value > max) return max;
  return value;
}

// raw = 100 * (10000 - edge_bp) * 2^52 / (10000 * (2^52 - X))
// crash = clamp(floor(raw), 100, max)
function crashPointFromX(x, { edgeBp = C.EDGE_BP, maxHundredths = C.MAX_HUNDREDTHS } = {}) {
  const X = BigInt(x);
  if (X < 0n || X >= TWO_52) throw new RangeError('X_OUT_OF_RANGE');
  if (!Number.isInteger(edgeBp) || edgeBp < 0 || edgeBp > 9999) {
    throw new RangeError('INVALID_EDGE');
  }
  const numerator = 100n * BigInt(10000 - edgeBp) * TWO_52;
  const denominator = 10000n * (TWO_52 - X);
  const raw = numerator / denominator;
  return clampHundredths(Number(raw), maxHundredths);
}

function crashPointFromHmacHex(hmac, { edgeBp = C.EDGE_BP, maxHundredths = C.MAX_HUNDREDTHS } = {}) {
  if (typeof hmac !== 'string' || !HEX_64.test(hmac)) throw new Error('INVALID_HMAC');
  const first13 = hmac.slice(0, 13);
  if (!HEX_13.test(first13)) throw new Error('INVALID_HMAC');
  return crashPointFromX(BigInt('0x' + first13), { edgeBp, maxHundredths });
}

function hmacForRound(serverSeed, clientSeed, nonce) {
  return hmacHex(serverSeed, `${clientSeed}:${nonce}`);
}

function crashPointHundredths({
  serverSeed,
  clientSeed,
  nonce,
  edgeBp = C.EDGE_BP,
  maxHundredths = C.MAX_HUNDREDTHS
}) {
  if (typeof serverSeed !== 'string' || !HEX_64.test(serverSeed)) throw new Error('INVALID_SEED');
  if (typeof clientSeed !== 'string' || !clientSeed) throw new Error('INVALID_CLIENT_SEED');
  if (!Number.isSafeInteger(nonce) || nonce < 1) throw new Error('INVALID_NONCE');
  return crashPointFromHmacHex(hmacForRound(serverSeed, clientSeed, nonce), { edgeBp, maxHundredths });
}

function multiplierHundredthsAt(elapsedMs, growthKMicro = C.GROWTH_K_MICRO) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 100;
  if (!Number.isInteger(growthKMicro) || growthKMicro <= 0) throw new Error('INVALID_GROWTH');
  const value = 100 * Math.exp((growthKMicro / 1e6) * (elapsedMs / 1000));
  if (!Number.isFinite(value) || value >= C.MAX_HUNDREDTHS) return C.MAX_HUNDREDTHS;
  return Math.floor(value);
}

function growthK(growthKMicro = C.GROWTH_K_MICRO) {
  return growthKMicro / 1e6;
}

function crashDurationMs(crashHundredths, growthKMicro = C.GROWTH_K_MICRO) {
  if (!Number.isInteger(crashHundredths) || crashHundredths < C.MIN_CRASH_HUNDREDTHS) {
    throw new RangeError('INVALID_CRASH_POINT');
  }
  if (!Number.isInteger(growthKMicro) || growthKMicro <= 0) throw new Error('INVALID_GROWTH');
  if (crashHundredths <= 100) return 0;
  const seconds = Math.log(crashHundredths / 100) / (growthKMicro / 1e6);
  return Math.max(0, Math.round(seconds * 1000));
}

function payoutSantim(stakeSantim, multiplierHundredths, maxWinSantim = C.MAX_WIN_SANTIM) {
  if (!Number.isSafeInteger(stakeSantim) || stakeSantim <= 0) throw new Error('INVALID_STAKE');
  if (!Number.isSafeInteger(multiplierHundredths) || multiplierHundredths < 100) {
    throw new Error('INVALID_MULTIPLIER');
  }
  if (!Number.isSafeInteger(maxWinSantim) || maxWinSantim <= 0) throw new Error('INVALID_MAX_WIN');
  const raw = (BigInt(stakeSantim) * BigInt(multiplierHundredths)) / 100n;
  return Number(raw > BigInt(maxWinSantim) ? BigInt(maxWinSantim) : raw);
}

function validateStake(value) {
  if (!Number.isSafeInteger(value) || value < C.MIN_STAKE_SANTIM || value > C.MAX_STAKE_SANTIM) {
    throw new Error('INVALID_STAKE');
  }
  return value;
}

function validatePanel(value) {
  if (!Number.isSafeInteger(value) || !C.PANELS.includes(value)) throw new Error('INVALID_PANEL');
  return value;
}

function validateAutoCashout(value) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < C.MIN_AUTO_CASHOUT_HUNDREDTHS || value > C.MAX_HUNDREDTHS) {
    throw new Error('INVALID_AUTO_CASHOUT');
  }
  return value;
}

function validateRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) throw new Error('INVALID_REQUEST');
  if (value.length < C.REQUEST_ID_MIN_LENGTH || value.length > C.REQUEST_ID_MAX_LENGTH) {
    throw new Error('INVALID_REQUEST');
  }
  return value;
}

// Display-only client multiplier. The server remains authoritative.
function displayMultiplierHundredths(serverNow, startedAt, growthKMicro = C.GROWTH_K_MICRO) {
  if (!Number.isFinite(serverNow) || !Number.isFinite(startedAt)) return 100;
  return multiplierHundredthsAt(serverNow - startedAt, growthKMicro);
}

// Public projection of a round. The seed and crash point exist only in the
// crashed state; every pre-crash response is built from this function so a
// future caller cannot accidentally serialize the whole row.
function publicRound(round) {
  if (!round) return null;
  const revealed = round.status === 'crashed';
  const view = {
    id: Number(round.id),
    phase: round.status,
    serverSeedHash: String(round.serverSeedHash || ''),
    clientSeed: String(round.clientSeed || ''),
    bettingClosesAt: round.bettingClosesAt == null ? null : Number(round.bettingClosesAt),
    startedAt: round.startedAt == null ? null : Number(round.startedAt)
  };
  if (round.crashedAt != null) view.crashedAt = Number(round.crashedAt);
  if (revealed) {
    view.crashHundredths = Number(round.crashHundredths);
    view.serverSeed = String(round.serverSeed || '');
  }
  return view;
}

// A pre-bet round (betting_closes_at IS NULL) is accepting stakes while the
// previous flying/crashed round is still on screen. The feed, chart and
// panels must follow the displayed round, not simply the newest row.
function selectDisplayRounds(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const latest = list[0] || null;
  let display = latest;
  if (latest && latest.status === 'betting' && latest.bettingClosesAt == null) {
    const previous = list.find((round) => round.id < latest.id && round.status !== 'betting');
    if (previous) display = previous;
  }
  const betting = list.find((round) => round.status === 'betting') || null;
  return { display, betting };
}

module.exports = {
  TWO_52,
  generateServerSeed,
  generateClientSeed,
  sha256Hex,
  serverSeedHash,
  hmacHex,
  hmacForRound,
  crashPointFromX,
  crashPointFromHmacHex,
  crashPointHundredths,
  multiplierHundredthsAt,
  displayMultiplierHundredths,
  growthK,
  crashDurationMs,
  payoutSantim,
  publicRound,
  selectDisplayRounds,
  validateStake,
  validatePanel,
  validateAutoCashout,
  validateRequestId
};
