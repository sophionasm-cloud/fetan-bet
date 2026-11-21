'use strict';

const assert = require('node:assert/strict');
const engine = require('./slot-engine');
const { createSlotService } = require('./slot-service');
const config = require('./public/games/slot/js/slot-config');

const fixedServerSeed = '00'.repeat(engine.SERVER_SEED_BYTES);
const fixedClientSeed = '0123456789abcdef0123456789abcdef';
assert.equal(engine.commitServerSeed(fixedServerSeed), '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925');
assert.deepEqual(engine.spinFromSeed(fixedServerSeed, fixedClientSeed, 0, 100).stops, [35, 50, 234, 77, 11]);
assert.throws(() => engine.spinFromSeed(fixedServerSeed, fixedClientSeed, -1, 100), /INVALID_FAIRNESS_INPUT/);

function requestId(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function memoryDatabase(initialBalance) {
  const state = { balance: initialBalance, rounds: [], epochs: [], ledger: [], nextId: 1, locks: new Set() };
  const transactions = new WeakMap();
  const joinedRound = (tx, row) => {
    const detail = JSON.parse(row.detail);
    const epoch = tx.epochs.find((entry) => entry.id === detail.seedEpochId && entry.user_id === row.user_id);
    return { ...row, epoch_server_seed: epoch?.server_seed || null, epoch_retired_at: epoch?.retired_at || null };
  };

  async function withTx(fn) {
    const tx = {
      balance: state.balance,
      rounds: state.rounds.map((row) => ({ ...row })),
      epochs: state.epochs.map((row) => ({ ...row })),
      ledger: state.ledger.map((row) => ({ ...row })),
      nextId: state.nextId,
    };
    const client = {
      query: async (query, params = []) => {
        const sql = query.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('SELECT r.*, e.server_seed AS epoch_server_seed')) {
          const row = tx.rounds.find((item) => item.user_id === params[0] && item.game === 'slot' && JSON.parse(item.detail).requestId === params[1]);
          if (!row) return { rows: [], rowCount: 0 };
          const base = joinedRound(tx, row);
          const seedEpochId = JSON.parse(row.detail).seedEpochId;
          const nextEpoch = tx.epochs.filter((e) => e.user_id === row.user_id && e.id > seedEpochId).sort((a, b) => a.id - b.id)[0];
          base.next_epoch_hash = nextEpoch?.server_seed_hash || null;
          return { rows: [base], rowCount: 1 };
        }
        if (sql === 'SELECT * FROM slot_seed_epochs WHERE user_id=$1 AND retired_at IS NULL') {
          const rows = tx.epochs.filter((item) => item.user_id === params[0] && item.retired_at == null);
          return { rows, rowCount: rows.length };
        }
        if (sql.endsWith('FOR UPDATE NOWAIT')) {
          if (state.locks.has(params[0])) throw Object.assign(new Error('lock unavailable'), { code: '55P03' });
          state.locks.add(params[0]);
          tx.lockedUserId = params[0];
          const rows = tx.epochs.filter((item) => item.user_id === params[0] && item.retired_at == null);
          return { rows, rowCount: rows.length };
        }
        if (sql.startsWith('INSERT INTO slot_seed_epochs')) {
          const [userId, serverSeed, hash, clientSeed] = params;
          if (!tx.epochs.some((item) => item.user_id === userId && item.retired_at == null)) {
            tx.epochs.push({ id: tx.nextId++, user_id: userId, server_seed: serverSeed, server_seed_hash: hash,
              client_seed: clientSeed, next_nonce: 0, completed_spins: 0, retired_at: null });
          }
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT balance FROM wallets')) return { rows: [{ balance: tx.balance }], rowCount: 1 };
        if (sql.startsWith('INSERT INTO game_rounds')) {
          const [userId, bet, payout, step, detail, serverSeed, clientSeed, seedHash] = params;
          const row = { id: tx.nextId++, user_id: userId, game: 'slot', bet, payout, step, status: 'done', detail,
            server_seed: serverSeed, client_seed: clientSeed, server_seed_hash: seedHash, created_at: new Date(0) };
          tx.rounds.push(row);
          return { rows: [{ id: row.id }], rowCount: 1 };
        }
        if (sql === 'UPDATE game_rounds SET detail=$1 WHERE id=$2') {
          const row = tx.rounds.find((item) => item.id === params[1]);
          row.detail = params[0];
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE slot_seed_epochs SET next_nonce=')) {
          const row = tx.epochs.find((item) => item.id === params[2]);
          row.next_nonce = params[0];
          row.completed_spins = params[1];
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE slot_seed_epochs SET retired_at=')) {
          const row = tx.epochs.find((item) => item.id === params[1]);
          row.retired_at = params[0];
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT r.id, r.bet, r.payout, r.detail')) {
          const rows = tx.rounds.filter((item) => item.user_id === params[0] && item.game === 'slot')
            .sort((a, b) => b.id - a.id).slice(0, params[1]).map((row) => joinedRound(tx, row));
          return { rows, rowCount: rows.length };
        }
        throw new Error(`Unexpected SQL in slot test: ${sql}`);
      },
    };
    transactions.set(client, tx);
    try {
      const result = await fn(client);
      state.balance = tx.balance;
      state.rounds = tx.rounds;
      state.epochs = tx.epochs;
      state.ledger = tx.ledger;
      state.nextId = tx.nextId;
      return result;
    } finally {
      if (tx.lockedUserId != null) state.locks.delete(tx.lockedUserId);
    }
  }

  const ledger = async ({ client, userId, delta, type, refType, refId }) => {
    const tx = transactions.get(client);
    if (tx.balance + delta < 0) throw new Error('INSUFFICIENT');
    tx.balance += delta;
    tx.ledger.push({ userId, delta, type, refType, refId, balance: tx.balance });
    return tx.balance;
  };

  return { state, withTx, ledger };
}

function createTestService(database) {
  let seedNumber = 1;
  return createSlotService({
    withTx: database.withTx,
    ledger: database.ledger,
    createEpoch: () => engine.createSeedEpoch({
      generateSeed: () => Buffer.alloc(engine.SERVER_SEED_BYTES, seedNumber++),
      generateClientSeed: () => fixedClientSeed,
    }),
    now: () => new Date(1),
  });
}

(async () => {
  const database = memoryDatabase(1000000);
  const service = createTestService(database);
  const initial = await service.state(7, 'en');
  assert.equal(initial.config.game, 'slot');
  assert.equal(initial.balance, 1000000);
  assert.equal(initial.fairness.server_seed, undefined);
  const first = await service.spin(7, { bet: config.MIN_BET_SANTIM, requestId: requestId(1) });
  assert.equal(first.replayed, false);
  assert.equal(first.fairness.server_seed, null);
  const repeated = await service.spin(7, { bet: config.MIN_BET_SANTIM, requestId: requestId(1) });
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.spinId, first.spinId);
  assert.equal(repeated.totalPayout, first.totalPayout);
  await assert.rejects(service.spin(7, { bet: 200, requestId: requestId(1) }), /SLOT_REQUEST_REUSED/);
  const entries = database.state.ledger.filter((entry) => entry.refId === first.spinId);
  assert.equal(entries.filter((entry) => entry.type === 'bet' && entry.delta === -100).length, 1);
  assert.ok(entries.filter((entry) => entry.type === 'win').length <= 1);
  assert.equal(entries.every((entry) => entry.refType === 'round'), true);

  const concurrentDb = memoryDatabase(10000);
  const concurrentService = createTestService(concurrentDb);
  await concurrentService.state(8);
  const simultaneous = await Promise.allSettled([
    concurrentService.spin(8, { bet: 100, requestId: requestId(2) }),
    concurrentService.spin(8, { bet: 100, requestId: requestId(2) }),
  ]);
  assert.equal(concurrentDb.state.ledger.filter((entry) => entry.type === 'bet').length, 1);
  assert.equal(concurrentDb.state.rounds.length, 1);
  assert.ok(simultaneous.some((item) => item.status === 'fulfilled'));

  const poorDb = memoryDatabase(50);
  const poorService = createTestService(poorDb);
  await poorService.state(9);
  await assert.rejects(poorService.spin(9, { bet: 100, requestId: requestId(3) }), /SLOT_INSUFFICIENT/);
  assert.equal(poorDb.state.ledger.length, 0);
  assert.equal(poorDb.state.rounds.length, 0);

  const rotationDb = memoryDatabase(10000000);
  const rotationService = createTestService(rotationDb);
  await rotationService.state(10);
  let lastSpin;
  for (let index = 0; index < config.SEED_EPOCH_SPINS; index++) {
    lastSpin = await rotationService.spin(10, { bet: 100, requestId: requestId(index + 10) });
  }
  assert.equal(lastSpin.fairness.retired, true);
  assert.equal(typeof lastSpin.fairness.server_seed, 'string');
  assert.equal(typeof lastSpin.fairness.next_server_seed_hash, 'string');
  assert.equal(rotationDb.state.epochs.filter((epoch) => epoch.user_id === 10 && epoch.retired_at == null).length, 1);
  const firstRetired = await rotationService.spin(10, { bet: 100, requestId: requestId(10) });
  assert.equal(firstRetired.replayed, true);
  assert.equal(firstRetired.fairness.retired, true);
  assert.equal(typeof firstRetired.fairness.server_seed, 'string');
  assert.equal(firstRetired.fairness.next_server_seed_hash, lastSpin.fairness.next_server_seed_hash);
  assert.equal((await rotationService.state(10)).recent.length, config.MAX_HISTORY_SPINS);

  console.log('slot-engine.test.js: HMAC vectors, idempotency, one debit, bounded credits, insufficient funds, and retired-seed rotation passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
