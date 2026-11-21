'use strict';

const crypto = require('node:crypto');
const config = require('./public/games/slot/js/slot-config');
const math = require('./public/games/slot/js/slot-math');

const SERVER_SEED_BYTES = 32;
const SERVER_SEED_PATTERN = /^[0-9a-f]{64}$/;
const CLIENT_SEED_PATTERN = /^[0-9a-f]{32}$/;

function normalizeServerSeed(serverSeed) {
  if (Buffer.isBuffer(serverSeed)) {
    if (serverSeed.length !== SERVER_SEED_BYTES) throw new TypeError('Server seed must be 32 bytes.');
    return Buffer.from(serverSeed);
  }
  if (typeof serverSeed !== 'string' || !SERVER_SEED_PATTERN.test(serverSeed)) {
    throw new TypeError('Server seed must be 64 lowercase hex characters.');
  }
  return Buffer.from(serverSeed, 'hex');
}

function commitServerSeed(serverSeed) {
  return crypto.createHash('sha256').update(normalizeServerSeed(serverSeed)).digest('hex');
}

function createSeedEpoch({ generateSeed = () => crypto.randomBytes(SERVER_SEED_BYTES),
  generateClientSeed = () => crypto.randomBytes(16).toString('hex') } = {}) {
  const serverSeed = normalizeServerSeed(generateSeed());
  const clientSeed = generateClientSeed();
  if (typeof clientSeed !== 'string' || !CLIENT_SEED_PATTERN.test(clientSeed)) {
    throw new TypeError('Client seed must be 32 lowercase hex characters.');
  }
  return {
    serverSeed: serverSeed.toString('hex'),
    serverSeedHash: commitServerSeed(serverSeed),
    clientSeed,
  };
}

function spinFromSeed(serverSeed, clientSeed, nonce, bet) {
  const key = normalizeServerSeed(serverSeed);
  if (typeof clientSeed !== 'string' || !CLIENT_SEED_PATTERN.test(clientSeed) ||
      !Number.isSafeInteger(nonce) || nonce < 0) throw new Error('INVALID_FAIRNESS_INPUT');
  if (!math.isValidBet(bet)) throw new Error('INVALID');
  const stops = config.REELS.map((_, reel) => crypto.createHmac('sha256', key)
    .update(`${clientSeed}:${nonce}:${reel}:slot:v${config.MATH_VERSION}`)
    .digest()[0]);
  return { stops, ...math.evaluateStops(stops, bet) };
}

module.exports = { SERVER_SEED_BYTES, commitServerSeed, createSeedEpoch, spinFromSeed };
