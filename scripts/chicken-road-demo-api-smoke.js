'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');

const BASE = 'http://127.0.0.1:3001';
const ENDPOINT_ID = 'ep-withered-pond-b5xflte3';

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
  const endpoint = assertExpectedNeonTestEndpoint(process.env.TEST_DATABASE_URL, ENDPOINT_ID);
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const phone = `+999${crypto.randomInt(100000000, 999999999)}`;
    const inserted = await client.query(`INSERT INTO users(name,phone,password_hash,role,lang,status)
      VALUES('Chicken Road Dash API smoke test',$1,'test-only-no-password','user','en','active') RETURNING id`, [phone]);
    const userId = Number(inserted.rows[0].id);
    const baseline = await client.query(`SELECT
      (SELECT count(*)::int FROM wallets WHERE user_id=$1) AS wallets,
      (SELECT count(*)::int FROM ledger WHERE user_id=$1) AS ledger`, [userId]);
    if (Number(baseline.rows[0].wallets) !== 0 || Number(baseline.rows[0].ledger) !== 0) {
      throw new Error('Synthetic user unexpectedly has financial rows.');
    }

    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const cookie = `token=${jwt.sign({ uid: userId }, secret, { expiresIn: '10m' })}`;
    async function request(path, method = 'GET', body) {
      const response = await fetch(`${BASE}${path}`, {
        method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${payload.error || 'unknown'}`);
      return payload;
    }

    const fresh = await request('/api/games/chicken-road-dash/demo');
    const before = Number(fresh.balance_santim);
    const startBody = { difficulty: 'medium', bet_santim: 500 };
    const started = await request('/api/games/chicken-road-dash/demo/start', 'POST', startBody);
    const duplicateStart = await request('/api/games/chicken-road-dash/demo/start', 'POST', startBody);
    if (started.id !== duplicateStart.id || Number(duplicateStart.balance_santim) !== before - 500) {
      throw new Error('Duplicate start did not preserve the single active demo round and stake.');
    }

    const crossId = crypto.randomUUID();
    const crossBody = { round_id: started.id, action_id: crossId };
    const crossResponses = await Promise.all([
      request('/api/games/chicken-road-dash/demo/cross', 'POST', crossBody),
      request('/api/games/chicken-road-dash/demo/cross', 'POST', crossBody),
    ]);
    if (!isDeepStrictEqual(crossResponses[0], crossResponses[1])) {
      throw new Error('Concurrent duplicate crossing returned different results.');
    }
    const afterRefresh = await request('/api/games/chicken-road-dash/demo');
    if (afterRefresh.round?.id !== started.id || Number(afterRefresh.round.step) !== Number(crossResponses[0].step)) {
      throw new Error('Refresh did not recover persisted round progress.');
    }
    const replayAsCashout = await fetch(`${BASE}/api/games/chicken-road-dash/demo/cashout`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(crossBody),
    });
    if (replayAsCashout.status !== 409) throw new Error('Reusing an action ID for a different action was not rejected.');

    let cashoutVerified = false;
    let crashVerified = Boolean(crossResponses[0].crashed);
    let cashoutRoundId = crossResponses[0].crashed ? null : started.id;
    // If this round committed a crash in lane one, use another independently
    // generated round until a safe first lane permits testing cash-out.
    for (let attempt = 0; attempt < 20 && !cashoutRoundId; attempt++) {
      const candidate = await request('/api/games/chicken-road-dash/demo/start', 'POST', {
        difficulty: 'medium', bet_santim: 500,
      });
      const result = await request('/api/games/chicken-road-dash/demo/cross', 'POST', {
        round_id: candidate.id, action_id: crypto.randomUUID(),
      });
      if (!result.crashed) cashoutRoundId = candidate.id;
      else {
        const proof = await request(`/api/games/chicken-road-dash/demo/verify/${candidate.id}`);
        crashVerified ||= proof.seed_commit_valid && proof.outcomes_match_seed && proof.merkle_proofs_valid;
      }
    }
    if (cashoutRoundId) {
      const cashoutId = crypto.randomUUID();
      const cashoutBody = { round_id: cashoutRoundId, action_id: cashoutId };
      const cashoutResponses = await Promise.all([
        request('/api/games/chicken-road-dash/demo/cashout', 'POST', cashoutBody),
        request('/api/games/chicken-road-dash/demo/cashout', 'POST', cashoutBody),
      ]);
      if (!isDeepStrictEqual(cashoutResponses[0], cashoutResponses[1])) {
        throw new Error('Concurrent duplicate cash-out returned different results.');
      }
      const verification = await request(`/api/games/chicken-road-dash/demo/verify/${cashoutRoundId}`);
      if (!verification.seed_commit_valid || !verification.outcomes_match_seed || !verification.merkle_proofs_valid) {
        throw new Error('Cash-out round verification failed.');
      }
      cashoutVerified = true;
    }

    // Find and verify a committed crash outcome without selecting or altering its result.
    for (let attempt = 0; attempt < 12 && !crashVerified; attempt++) {
      const round = await request('/api/games/chicken-road-dash/demo/start', 'POST', {
        difficulty: 'easy', bet_santim: 100,
      });
      for (let lane = 0; lane < 15; lane++) {
        const result = await request('/api/games/chicken-road-dash/demo/cross', 'POST', {
          round_id: round.id, action_id: crypto.randomUUID(),
        });
        if (result.crashed) {
          const proof = await request(`/api/games/chicken-road-dash/demo/verify/${round.id}`);
          if (!proof.seed_commit_valid || !proof.outcomes_match_seed || !proof.merkle_proofs_valid) {
            throw new Error('Crash round verification failed.');
          }
          crashVerified = true;
          break;
        }
        if (result.finished) break;
      }
    }

    const finalFinancial = await client.query(`SELECT
      (SELECT count(*)::int FROM wallets WHERE user_id=$1) AS wallets,
      (SELECT count(*)::int FROM ledger WHERE user_id=$1) AS ledger`, [userId]);
    const isolation = Number(finalFinancial.rows[0].wallets) === 0 && Number(finalFinancial.rows[0].ledger) === 0;
    if (!isolation) throw new Error('Demo gameplay created a real wallet or ledger row.');
    console.log(JSON.stringify({
      endpointId: endpoint.endpointId,
      syntheticUserId: userId,
      demoBalanceLoaded: Number.isSafeInteger(before) && before > 0,
      startAndDuplicateStart: true,
      concurrentDuplicateCross: true,
      refreshRecovery: true,
      replayWithChangedActionTypeRejected: true,
      cashoutAndVerification: cashoutVerified,
      crashAndVerification: crashVerified,
      realWalletRowsBeforeAfter: [Number(baseline.rows[0].wallets), Number(finalFinancial.rows[0].wallets)],
      realLedgerRowsBeforeAfter: [Number(baseline.rows[0].ledger), Number(finalFinancial.rows[0].ledger)],
      demoRealMoneyIsolation: isolation,
    }));
    if (!cashoutVerified || !crashVerified) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Chicken Road Dash test-branch API check failed: ${error.message}`);
  process.exitCode = 1;
});
