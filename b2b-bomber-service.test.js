'use strict';

// Database-free state-machine and wallet-safety test for B2B Bomber.
const assert = require('node:assert/strict');
const math = require('./b2b-bomber-math');
const { createB2BBomberService, GAME_KEY } = require('./b2b-bomber-service');

const USER = 7;
const SEED_HEX = '00'.repeat(32);
const ROUND_UUID = '00000000-0000-4000-8000-000000000189'; // seed+client => 1.50x
const ACTION_1 = '11111111-1111-4111-8111-111111111111';
const ACTION_2 = '22222222-2222-4222-8222-222222222222';
const ACTION_3 = '33333333-3333-4333-8333-333333333333';
const ACTION_CASH = '44444444-4444-4444-8444-444444444444';

class FakeDb {
  constructor() {
    this.balance = 100000;
    this.rounds = [];
    this.nextId = 1;
    this.entries = [];
    this.ledgerKeys = new Set();
  }

  rowsMatching(predicate) {
    return this.rounds.filter(predicate);
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim();

    if (text.startsWith('SELECT balance FROM wallets')) {
      return { rowCount: 1, rows: [{ balance: this.balance }] };
    }

    if (text.includes("detail::jsonb->>'startActionId'")) {
      const [userId, game, actionId] = params;
      const rows = this.rowsMatching((r) => r.user_id === Number(userId) && r.game === game && JSON.parse(r.detail).startActionId === actionId)
        .sort((a, b) => b.id - a.id).slice(0, 1);
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('SELECT * FROM game_rounds WHERE user_id=$1 AND game=$2 AND status=\'active\'')) {
      const [userId, game] = params;
      const rows = this.rowsMatching((r) => r.user_id === Number(userId) && r.game === game && r.status === 'active');
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('INSERT INTO game_rounds')) {
      const [userId, game, bet, detail, seed, clientSeed, hash] = params;
      const row = {
        id: this.nextId++,
        user_id: Number(userId),
        game,
        bet: Number(bet),
        payout: 0,
        step: 0,
        status: 'active',
        detail,
        server_seed: seed,
        client_seed: clientSeed,
        server_seed_hash: hash,
        difficulty: 'standard',
        created_at: new Date().toISOString(),
      };
      this.rounds.push(row);
      return { rowCount: 1, rows: [row] };
    }

    if (text.startsWith('UPDATE game_rounds SET status=\'done\'')) {
      const [id, payout, step, detail] = params;
      const row = this.rounds.find((r) => r.id === Number(id) && r.status === 'active');
      if (!row) return { rowCount: 0, rows: [] };
      row.payout = Number(payout);
      row.step = Number(step);
      row.detail = detail;
      row.status = 'done';
      return { rowCount: 1, rows: [row] };
    }

    if (text.startsWith('SELECT * FROM game_rounds WHERE id=$1 AND user_id=$2 AND game=$3')) {
      const [id, userId, game] = params;
      const rows = this.rowsMatching((r) => r.id === Number(id) && r.user_id === Number(userId) && r.game === game);
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('SELECT * FROM game_rounds WHERE id=$1 AND status=$2')) {
      const [id, status] = params;
      const rows = this.rowsMatching((r) => r.id === Number(id) && r.status === status);
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('SELECT * FROM game_rounds WHERE id=$1')) {
      const rows = this.rowsMatching((r) => r.id === Number(params[0]));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('SELECT * FROM game_rounds WHERE user_id=$1 AND game=$2 ORDER BY id DESC LIMIT 1')) {
      const [userId, game] = params;
      const rows = this.rowsMatching((r) => r.user_id === Number(userId) && r.game === game).sort((a, b) => b.id - a.id).slice(0, 1);
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('SELECT * FROM game_rounds WHERE user_id=$1 AND game=$2 ORDER BY id DESC LIMIT $3')) {
      const [userId, game, limit] = params;
      const rows = this.rowsMatching((r) => r.user_id === Number(userId) && r.game === game).sort((a, b) => b.id - a.id).slice(0, Number(limit));
      return { rowCount: rows.length, rows };
    }

    if (text.includes("status<>'active'") && text.includes('ORDER BY id DESC LIMIT')) {
      const [userId, game, limit] = params;
      const rows = this.rowsMatching((r) => r.user_id === Number(userId) && r.game === game && r.status !== 'active')
        .sort((a, b) => b.id - a.id).slice(0, Number(limit));
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith('SELECT id, user_id FROM game_rounds WHERE game=$1')) {
      const [game, limit] = params;
      const rows = this.rowsMatching((r) => r.game === game && r.status === 'active').sort((a, b) => a.id - b.id).slice(0, Number(limit));
      return { rowCount: rows.length, rows: rows.map((r) => ({ id: r.id, user_id: r.user_id })) };
    }

    throw new Error(`FakeDb does not handle: ${text}`);
  }

  async withTx(fn) {
    return fn({ query: (sql, params) => this.query(sql, params) });
  }

  async ledger({ userId, delta, type, refType, refId }) {
    const key = `${type}|${refType}|${refId}`;
    if (this.ledgerKeys.has(key)) throw new Error('duplicate ledger');
    this.ledgerKeys.add(key);
    this.balance += Number(delta);
    if (this.balance < 0) throw new Error('INSUFFICIENT');
    this.entries.push({ userId, delta: Number(delta), type, refType, refId });
    return this.balance;
  }
}

(async () => {
  let clock = 1_000_000;
  const db = new FakeDb();
  let seedCalls = 0;
  const service = createB2BBomberService({
    query: db.query.bind(db),
    withTx: db.withTx.bind(db),
    ledger: db.ledger.bind(db),
    generateSeed: () => { seedCalls++; return Buffer.from(SEED_HEX, 'hex'); },
    generateId: () => ROUND_UUID,
    now: () => clock,
  });

  // ---- placement, commitment, one debit ----
  const started = await service.start(USER, {
    bet_santim: 10000,
    auto_cashout_hundredths: null,
    client_seed: 'service-test',
    action_id: ACTION_1,
  });
  assert.equal(started.replayed, false);
  assert.equal(started.balance_santim, 90000);
  assert.equal(started.round.active, true);
  assert.equal(started.round.phase, 'countdown');
  assert.equal(started.round.crash_hundredths, null, 'active state must never leak the crash');
  assert.equal(started.round.server_seed_hash.length, 64);
  assert.equal(started.round.client_seed, 'service-test');
  assert.equal(db.entries.length, 1);
  assert.deepEqual(db.entries[0], { userId: USER, delta: -10000, type: 'bet', refType: 'round', refId: 1 });

  // Same action id is idempotent and cannot double-debit.
  const replay = await service.start(USER, {
    bet_santim: 10000,
    auto_cashout_hundredths: null,
    client_seed: 'service-test',
    action_id: ACTION_1,
  });
  assert.equal(replay.replayed, true);
  assert.equal(db.balance, 90000);
  assert.equal(db.entries.length, 1);

  // Reusing the same action id with a different request is rejected rather
  // than silently returning the original round.
  await assert.rejects(
    service.start(USER, { bet_santim: 2000, client_seed: 'service-test', action_id: ACTION_1.toUpperCase() }),
    /STALE_ACTION/
  );

  // A different action cannot open a second active round.
  await assert.rejects(service.start(USER, { bet_santim: 1000, action_id: ACTION_2 }), /ACTIVE_ROUND/);

  // Cash-out before the flight is rejected.
  clock = 1_001_000;
  await assert.rejects(service.cashout(USER, { round_id: 1, action_id: ACTION_CASH }), /INVALID/);

  // ---- manual cash-out at 1.40x ----
  const detail = JSON.parse(db.rounds[0].detail);
  clock = detail.flightStartedAt + math.timeToHundredths(140) + 5;
  const cashed = await service.cashout(USER, { round_id: 1, action_id: ACTION_CASH });
  assert.equal(cashed.round.status, 'cashed_out');
  assert.equal(cashed.round.cashout_hundredths, 140);
  assert.equal(cashed.round.payout_santim, 14000);
  assert.equal(cashed.round.crash_hundredths, 150);
  assert.equal(cashed.balance_santim, 104000);
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries[1].type, 'win');

  // Duplicate cash-out is a read, not a second credit.
  const duplicate = await service.cashout(USER, { round_id: 1, action_id: ACTION_CASH });
  assert.equal(duplicate.replayed, true);
  assert.equal(db.balance, 104000);
  assert.equal(db.entries.length, 2);

  // ---- fairness reveal and verification ----
  const fairness = await service.verifyOwned(USER, 1);
  assert.equal(fairness.commitment_valid, true);
  assert.equal(fairness.outcome_matches, true);
  assert.equal(fairness.computed_crash_hundredths, 150);
  assert.equal(fairness.server_seed, SEED_HEX);
  const payload = service.verifyPayload({
    server_seed: fairness.server_seed,
    client_seed: fairness.client_seed,
    nonce: fairness.nonce,
  });
  assert.equal(payload.computed_crash_hundredths, 150);

  // ---- automatic cash-out settles without any browser request ----
  const auto = await service.start(USER, {
    bet_santim: 10000,
    auto_cashout_hundredths: 120,
    client_seed: 'service-test',
    action_id: ACTION_2,
  });
  assert.equal(auto.round.active, true);
  const autoDetail = JSON.parse(db.rounds[1].detail);
  clock = autoDetail.flightStartedAt + math.timeToHundredths(120) + 5;
  const swept = await service.sweep();
  assert.equal(swept.settled, 1);
  const autoRow = db.rounds[1];
  assert.equal(JSON.parse(autoRow.detail).result, 'auto_cashout');
  assert.equal(Number(autoRow.payout), 12000);
  assert.equal(db.balance, 104000 - 10000 + 12000);

  // ---- crash after an unreachable automatic target means loss, no credit ----
  const loss = await service.start(USER, {
    bet_santim: 10000,
    auto_cashout_hundredths: 200,
    client_seed: 'service-test',
    action_id: ACTION_3,
  });
  assert.equal(loss.round.active, true);
  const lossDetail = JSON.parse(db.rounds[2].detail);
  clock = lossDetail.crashAt + 1;
  const state = await service.current(USER);
  assert.equal(state.round.status, 'lost');
  assert.equal(state.round.payout_santim, 0);
  assert.equal(state.round.crash_hundredths, 150);
  const winsBefore = db.entries.filter((entry) => entry.type === 'win').length;
  assert.equal(winsBefore, 2, 'lost round must not create a win credit');

  // ---- active fairness is not revealed; history hides the seed ----
  await service.start(USER, { bet_santim: 1000, action_id: '55555555-5555-4555-8555-555555555555', client_seed: 'service-test' });
  await assert.rejects(service.verifyOwned(USER, 4), /INVALID/);
  const history = await service.history(USER);
  const activeEntry = history.history.find((entry) => entry.active);
  assert.ok(activeEntry);
  assert.equal(activeEntry.server_seed, null);
  assert.equal(activeEntry.crash_hundredths, null);

  // ---- never access another player's round ----
  await assert.rejects(service.cashout(USER + 1, { round_id: 1, action_id: ACTION_CASH }), /NOT_FOUND/);
  await assert.rejects(service.verifyOwned(USER + 1, 1), /NOT_FOUND/);

  assert.equal(seedCalls, 4);
  console.log('B2B Bomber service OK: one debit, one credit, idempotent replays, server auto-cash-out, crash loss, commitment reveal');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
